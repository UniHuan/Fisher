import { track } from '../../analytics';
import {
  createReport,
  getClientConfig,
  getDictionaries,
  restrictionDateText,
  type CreateReportInput,
  type ReportContentType,
} from '../../api';
import {
  MAX_CONTENT_CODE_POINTS,
  contentCodePointCount,
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
}

interface FishOption {
  key: string;
  label: string;
}

interface CreateData {
  spotId: string;
  spotName: string;
  loadingConfig: boolean;
  configError: string;
  ugcEnabled: boolean;
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
  termsAccepted: boolean;
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
  submit(): Promise<void>;
  cancel(): void;
  isDirty(): boolean;
  syncBackGuard(): void;
  disableGuard(): void;
  onUnload(): void;
}

const CONTENT_TYPES: ContentTypeOption[] = [
  { key: 'comment', label: '评论' },
  { key: 'catch', label: '鱼获' },
  { key: 'intel', label: '情报' },
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
    termsAccepted: false,
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

    this.setData({
      loadingConfig: false,
      ugcEnabled,
      termsVersion: config?.legal.terms_version ?? '',
      fishOptions,
      fishLabels: fishOptions.map((item) => item.label),
      sessionReady: getSession() !== null,
      configError: config === null ? '配置加载失败，请重试' : '',
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
    } catch {
      track('ugc_login_fail', { result: 'fail' });
      this.setData({ loggingIn: false });
      wx.showToast({ title: '登录失败，请重试', icon: 'none' });
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
    const draft: ReportDraft = {
      content_type: this.data.contentType,
      content: this.data.content,
      fish_key: this.data.contentType === 'catch' ? this.data.fishKey : null,
      catch_weight_kg:
        this.data.contentType === 'catch' && weightText !== ''
          ? Number(weightText)
          : null,
      image_count: 0,
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
      image_count: 0,
    });
    try {
      const result = await createReport(input);
      track('ugc_submit_result', {
        spot_id: this.data.spotId,
        content_type: this.data.contentType,
        result: 'success',
        status: result.moderation_status,
        image_count: 0,
      });
      if (result.moderation_status === 'machine_rejected') {
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
      const message = error instanceof Error ? error.message : '发布失败，请重试';
      track('ugc_submit_result', {
        spot_id: this.data.spotId,
        content_type: this.data.contentType,
        result: 'fail',
        image_count: 0,
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
    if (this.data.content.trim().length > 0) {
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
