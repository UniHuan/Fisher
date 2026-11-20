import { track } from '../../analytics';
import {
  createReport,
  getClientConfig,
  getDictionaries,
  loginFailureText,
  restrictionDateText,
  uploadUgcImage,
  type CreateReportInput,
  type ReportContentType,
} from '../../api';
import {
  MAX_CONTENT_CODE_POINTS,
  MAX_REPORT_IMAGES,
  contentCodePointCount,
  submitReportWithImages,
  validateReportDraft,
  type ReportDraft,
} from '../../report-form';
import { ensureSession, getMe, getSession } from '../../session';

interface LoadOptions {
  spot_id?: string;
  spot_name?: string;
}

interface ContentTypeOption {
  key: ReportContentType;
  label: string;
  mark: string;
  desc: string;
}

interface FishOption {
  key: string;
  label: string;
}

interface DraftImage {
  path: string;
  key: string;
  progress: number;
}

interface CreateData {
  spotId: string;
  spotName: string;
  loadingConfig: boolean;
  configError: string;
  ugcEnabled: boolean;
  feedbackEnabled: boolean;
  termsVersion: string;
  sessionReady: boolean;
  meCanPublish: boolean;
  restrictionText: string;
  contentTypes: ContentTypeOption[];
  contentType: ReportContentType;
  content: string;
  contentCount: number;
  maxContentLength: number;
  fishOptions: FishOption[];
  fishLabels: string[];
  fishIndex: number;
  fishKey: string;
  fishLabel: string;
  weight: string;
  images: DraftImage[];
  maxImages: number;
  termsAccepted: boolean;
  termsUrl: string;
  privacyUrl: string;
  communityUrl: string;
  legalNote: string;
  submitting: boolean;
  loggingIn: boolean;
  submitError: string;
}

interface TypeTapEvent {
  currentTarget: { dataset: { type: string } };
}

interface InputEvent {
  detail: { value: string };
}

interface PickerEvent {
  detail: { value: string };
}

interface CheckboxEvent {
  detail: { value: string[] };
}

interface ImageTapEvent {
  currentTarget: { dataset: { index: string } };
}

interface LegalTapEvent {
  currentTarget: { dataset: { key: string } };
}

interface CreateMethods {
  init(): Promise<void>;
  retryConfig(): void;
  login(): Promise<void>;
  loadMe(): Promise<void>;
  selectType(event: TypeTapEvent): void;
  onContentInput(event: InputEvent): void;
  onFishChange(event: PickerEvent): void;
  onWeightInput(event: InputEvent): void;
  onTermsChange(event: CheckboxEvent): void;
  openLegal(event: LegalTapEvent): void;
  copyLegalUrl(url: string): void;
  chooseImages(): void;
  removeImage(event: ImageTapEvent): void;
  previewDraftImage(event: ImageTapEvent): void;
  updateImageProgress(index: number, progress: number): void;
  markImageUploaded(index: number, key: string): void;
  clearImageKeys(): void;
  openFeedback(): void;
  submit(): Promise<void>;
  cancel(): void;
  isDirty(): boolean;
  syncBackGuard(): void;
  disableGuard(): void;
  onUnload(): void;
}

const CONTENT_TYPES: ContentTypeOption[] = [
  { key: 'comment', label: '评论', mark: '评', desc: '现场观察' },
  { key: 'catch', label: '鱼获', mark: '获', desc: '鱼种与重量' },
  { key: 'intel', label: '情报', mark: '报', desc: '收费与鱼情' },
];

function decodeOption(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return '';
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

Page<CreateData, CreateMethods>({
  data: {
    spotId: '',
    spotName: '',
    loadingConfig: true,
    configError: '',
    ugcEnabled: false,
    feedbackEnabled: false,
    termsVersion: '',
    sessionReady: false,
    meCanPublish: true,
    restrictionText: '',
    contentTypes: CONTENT_TYPES,
    contentType: 'comment',
    content: '',
    contentCount: 0,
    maxContentLength: MAX_CONTENT_CODE_POINTS,
    fishOptions: [],
    fishLabels: [],
    fishIndex: 0,
    fishKey: '',
    fishLabel: '',
    weight: '',
    images: [],
    maxImages: MAX_REPORT_IMAGES,
    termsAccepted: false,
    termsUrl: '',
    privacyUrl: '',
    communityUrl: '',
    legalNote: '',
    submitting: false,
    loggingIn: false,
    submitError: '',
  },

  onLoad(options: LoadOptions) {
    this.setData({
      spotId: decodeOption(options.spot_id),
      spotName: decodeOption(options.spot_name),
    });
    void this.init();
  },

  onUnload() {
    this.disableGuard();
  },

  async init(): Promise<void> {
    if (this.data.spotId === '') {
      this.setData({ loadingConfig: false, configError: '缺少钓点编号，请返回重试' });
      return;
    }
    this.setData({ loadingConfig: true, configError: '' });
    const [configResult, dictionariesResult] = await Promise.allSettled([
      getClientConfig(),
      getDictionaries(),
    ] as const);

    const config = configResult.status === 'fulfilled' ? configResult.value : null;
    const dictionaries =
      dictionariesResult.status === 'fulfilled' ? dictionariesResult.value : null;
    const fishOptions: FishOption[] = (dictionaries?.fish_types ?? []).map((item) => ({
      key: item.key,
      label: item.label,
    }));
    const ugcEnabled = config?.features.ugc === true;
    const feedbackEnabled = config?.features.feedback === true;
    const termsUrl = config?.legal.terms_url ?? '';
    const privacyUrl = config?.legal.privacy_url ?? '';
    const communityUrl = config?.legal.community_url ?? '';

    this.setData({
      loadingConfig: false,
      ugcEnabled,
      feedbackEnabled,
      termsVersion: config?.legal.terms_version ?? '',
      fishOptions,
      fishLabels: fishOptions.map((item) => item.label),
      sessionReady: getSession() !== null,
      configError: config === null ? '配置加载失败，请重试' : '',
      termsUrl,
      privacyUrl,
      communityUrl,
      legalNote:
        termsUrl === '' && privacyUrl === '' && communityUrl === ''
          ? '法务链接暂未开放'
          : '',
    });

    if (ugcEnabled && getSession() !== null) {
      await this.loadMe();
    }
  },

  retryConfig(): void {
    void this.init();
  },

  async login(): Promise<void> {
    if (this.data.loggingIn) {
      return;
    }
    this.setData({ loggingIn: true, submitError: '' });
    track('ugc_login_start');
    try {
      await ensureSession();
      track('ugc_login_success');
      this.setData({ sessionReady: true, loggingIn: false });
      await this.loadMe();
    } catch (error) {
      track('ugc_login_fail', { result: 'fail' });
      this.setData({ loggingIn: false });
      wx.showToast({ title: loginFailureText(error), icon: 'none' });
    }
  },

  async loadMe(): Promise<void> {
    try {
      const me = await getMe();
      const date = restrictionDateText(me.restricted_until);
      this.setData({
        sessionReady: true,
        meCanPublish: me.can_publish,
        restrictionText: me.can_publish
          ? ''
          : date === ''
            ? '当前账号暂不能发布内容'
            : `发布功能限制至 ${date}`,
      });
    } catch {
      // A failed check must not hide an otherwise valid form.
      this.setData({ sessionReady: getSession() !== null, meCanPublish: true });
    }
  },

  selectType(event: TypeTapEvent): void {
    const key = event.currentTarget.dataset.type;
    const option = CONTENT_TYPES.find((item) => item.key === key);
    if (option === undefined || option.key === this.data.contentType) {
      return;
    }
    this.setData({
      contentType: option.key,
      submitError: '',
      ...(option.key === 'catch'
        ? {}
        : { fishIndex: 0, fishKey: '', fishLabel: '', weight: '' }),
    });
    this.syncBackGuard();
  },

  onContentInput(event: InputEvent): void {
    this.setData({
      content: event.detail.value,
      contentCount: contentCodePointCount(event.detail.value),
      submitError: '',
    });
    this.syncBackGuard();
  },

  onFishChange(event: PickerEvent): void {
    const index = Number(event.detail.value);
    const option = this.data.fishOptions[index];
    if (option === undefined) {
      return;
    }
    this.setData({ fishIndex: index, fishKey: option.key, fishLabel: option.label });
    this.syncBackGuard();
  },

  onWeightInput(event: InputEvent): void {
    this.setData({ weight: event.detail.value, submitError: '' });
    this.syncBackGuard();
  },

  onTermsChange(event: CheckboxEvent): void {
    this.setData({ termsAccepted: event.detail.value.includes('terms') });
  },

  openLegal(event: LegalTapEvent): void {
    const key = event.currentTarget.dataset.key;
    const urls: Record<string, string> = {
      terms: this.data.termsUrl,
      privacy: this.data.privacyUrl,
      community: this.data.communityUrl,
    };
    const url = urls[key] ?? '';
    if (url === '') {
      wx.showToast({ title: '法务链接暂未开放', icon: 'none' });
      return;
    }
    let webViewAvailable: boolean;
    try {
      webViewAvailable = wx.canIUse('web-view');
    } catch {
      webViewAvailable = true;
    }
    if (!webViewAvailable) {
      this.copyLegalUrl(url);
      return;
    }
    wx.navigateTo({
      url: `/pages/legal/legal?url=${encodeURIComponent(url)}`,
      fail: () => this.copyLegalUrl(url),
    });
  },

  copyLegalUrl(url: string): void {
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' });
      },
    });
  },

  chooseImages(): void {
    if (this.data.submitting) {
      return;
    }
    const remaining = MAX_REPORT_IMAGES - this.data.images.length;
    if (remaining <= 0) {
      wx.showToast({ title: `最多上传 ${MAX_REPORT_IMAGES} 张图片`, icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (result) => {
        const additions: DraftImage[] = result.tempFiles.map((file) => ({
          path: file.tempFilePath,
          key: '',
          progress: 0,
        }));
        const images = [...this.data.images, ...additions].slice(0, MAX_REPORT_IMAGES);
        this.setData({ images, submitError: '' });
        track('ugc_image_add', {
          spot_id: this.data.spotId,
          content_type: this.data.contentType,
          image_count: images.length,
        });
        this.syncBackGuard();
      },
      fail: (error) => {
        if ((error.errMsg || '').indexOf('cancel') < 0) {
          wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
        }
      },
    });
  },

  removeImage(event: ImageTapEvent): void {
    if (this.data.submitting) {
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    const images = this.data.images.filter((_image, itemIndex) => itemIndex !== index);
    this.setData({ images, submitError: '' });
    this.syncBackGuard();
  },

  previewDraftImage(event: ImageTapEvent): void {
    const index = Number(event.currentTarget.dataset.index);
    const urls = this.data.images.map((image) => image.path);
    if (urls.length === 0) {
      return;
    }
    wx.previewImage({ current: urls[index], urls });
  },

  updateImageProgress(index: number, progress: number): void {
    this.setData({ [`images[${index}].progress`]: progress });
  },

  markImageUploaded(index: number, key: string): void {
    const images = this.data.images.map((image, itemIndex) =>
      itemIndex === index ? { ...image, key, progress: 100 } : image,
    );
    this.setData({ images });
  },

  clearImageKeys(): void {
    const images = this.data.images.map((image) => ({
      ...image,
      key: '',
      progress: 0,
    }));
    this.setData({ images });
  },

  openFeedback(): void {
    const params = ['category=bug', 'page=report-create'];
    if (this.data.spotId !== '') {
      params.push(`spot_id=${encodeURIComponent(this.data.spotId)}`);
    }
    if (this.data.spotName !== '') {
      params.push(`spot_name=${encodeURIComponent(this.data.spotName)}`);
    }
    wx.navigateTo({ url: `/pages/feedback/index?${params.join('&')}` });
  },

  async submit(): Promise<void> {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.ugcEnabled) {
      wx.showToast({ title: '社区功能暂未开放', icon: 'none' });
      return;
    }
    if (!this.data.sessionReady) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (!this.data.meCanPublish) {
      wx.showToast({
        title: this.data.restrictionText || '当前账号暂不能发布内容',
        icon: 'none',
      });
      return;
    }
    if (this.data.termsVersion === '') {
      this.setData({ submitError: '协议版本未加载，请稍后重试' });
      return;
    }

    const weightText = this.data.weight.trim();
    const imageCount = this.data.images.length;
    const draft: ReportDraft = {
      content_type: this.data.contentType,
      content: this.data.content,
      fish_key: this.data.contentType === 'catch' ? this.data.fishKey : null,
      catch_weight_kg:
        this.data.contentType === 'catch' && weightText !== ''
          ? Number(weightText)
          : null,
      image_count: imageCount,
      terms_accepted: this.data.termsAccepted,
    };
    const validation = validateReportDraft(draft);
    if (!validation.ok) {
      this.setData({ submitError: validation.message });
      return;
    }

    const input: CreateReportInput = {
      spot_id: this.data.spotId,
      content_type: this.data.contentType,
      content: this.data.content.trim(),
      terms_version: this.data.termsVersion,
    };
    if (this.data.contentType === 'catch') {
      input.fish_key = this.data.fishKey;
      if (draft.catch_weight_kg !== null && draft.catch_weight_kg !== undefined) {
        input.catch_weight_kg = draft.catch_weight_kg;
      }
    }

    this.setData({ submitting: true, submitError: '' });
    track('ugc_submit', {
      spot_id: this.data.spotId,
      content_type: this.data.contentType,
      image_count: imageCount,
    });
    let uploadFailed = false;
    try {
      const outcome = await submitReportWithImages({
        input,
        images: this.data.images.map((image) => ({
          path: image.path,
          key: image.key,
        })),
        upload: async (path, onProgress) => {
          try {
            const uploaded = await uploadUgcImage(path, onProgress);
            return uploaded.key;
          } catch (error) {
            uploadFailed = true;
            throw error;
          }
        },
        create: createReport,
        onProgress: (index, progress) => this.updateImageProgress(index, progress),
        onImageUploaded: (index, key) => this.markImageUploaded(index, key),
      });
      const result = outcome.result;
      track('ugc_submit_result', {
        spot_id: this.data.spotId,
        content_type: this.data.contentType,
        result: 'success',
        status: result.moderation_status,
        image_count: imageCount,
      });
      if (result.moderation_status === 'machine_rejected') {
        // The server consumed the uploaded keys; a retry needs fresh uploads.
        this.clearImageKeys();
        this.setData({ submitting: false });
        wx.showModal({
          title: '内容未通过审核',
          content: result.message || '请修改内容后重试',
          showCancel: false,
        });
        return;
      }
      this.disableGuard();
      if (result.moderation_status === 'machine_pending') {
        this.setData({ submitting: false });
        wx.showModal({
          title: '内容审核中',
          content: '内容审核中，通过后会展示。',
          showCancel: false,
          success: () => {
            wx.navigateBack({ delta: 1 });
          },
        });
        return;
      }
      wx.showToast({ title: '已发布', icon: 'success', duration: 1200 });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 800);
    } catch (error) {
      const message = uploadFailed
        ? '图片上传失败，已填内容和已上传图片会保留，请重试'
        : error instanceof Error
          ? error.message
          : '发布失败，请重试';
      if (!uploadFailed) {
        // A create attempt may have consumed the keys; upload again on retry.
        this.clearImageKeys();
      }
      track('ugc_submit_result', {
        spot_id: this.data.spotId,
        content_type: this.data.contentType,
        result: 'fail',
        image_count: imageCount,
      });
      this.setData({ submitting: false, submitError: message });
    }
  },

  cancel(): void {
    if (!this.isDirty()) {
      this.disableGuard();
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.showModal({
      title: '放弃编辑',
      content: '内容还没有发布，确定离开吗？',
      confirmText: '离开',
      cancelText: '继续编辑',
      success: (result) => {
        if (result.confirm) {
          this.disableGuard();
          wx.navigateBack({ delta: 1 });
        }
      },
    });
  },

  isDirty(): boolean {
    if (this.data.content.trim().length > 0 || this.data.images.length > 0) {
      return true;
    }
    if (
      this.data.contentType === 'catch' &&
      (this.data.fishKey !== '' || this.data.weight.trim() !== '')
    ) {
      return true;
    }
    return false;
  },

  syncBackGuard(): void {
    try {
      if (this.isDirty()) {
        wx.enableAlertBeforeUnload({ message: '内容还没有发布，确定离开吗？' });
      } else {
        wx.disableAlertBeforeUnload();
      }
    } catch {
      // Older base libraries do not support the back guard.
    }
  },

  disableGuard(): void {
    try {
      wx.disableAlertBeforeUnload();
    } catch {
      // Ignore unsupported base libraries.
    }
  },
});
