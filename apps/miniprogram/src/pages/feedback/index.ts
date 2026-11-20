import { track } from '../../analytics';
import {
  CLIENT_VERSION,
  createFeedback,
  getClientConfig,
  loginFailureText,
  uploadFeedbackImage,
  type CreateFeedbackInput,
} from '../../api';
import {
  MAX_CONTACT_LENGTH,
  MAX_CONTENT_CODE_POINTS,
  MAX_FEEDBACK_IMAGES,
  MIN_CONTENT_CODE_POINTS,
  PHOTO_CONSENT_TEXT,
  contentCodePointCount,
  isFeedbackCategory,
  validateFeedbackDraft,
  type FeedbackCategory,
  type FeedbackDraft,
} from '../../feedback-form';
import { ensureSession, getSession } from '../../session';

interface LoadOptions {
  category?: string;
  spot_id?: string;
  spot_name?: string;
  page?: string;
}

interface FeedbackCategoryOption {
  key: FeedbackCategory;
  label: string;
  desc: string;
}

interface DraftImage {
  path: string;
  key: string;
  progress: number;
}

interface FeedbackData {
  loadingConfig: boolean;
  configError: string;
  feedbackEnabled: boolean;
  sessionReady: boolean;
  loggingIn: boolean;
  categories: FeedbackCategoryOption[];
  category: FeedbackCategory | '';
  content: string;
  contentCount: number;
  minContentLength: number;
  maxContentLength: number;
  images: DraftImage[];
  maxImages: number;
  contact: string;
  maxContactLength: number;
  photoConsent: boolean;
  photoConsentText: string;
  spotId: string;
  spotName: string;
  pagePath: string;
  submitting: boolean;
  submitError: string;
}

interface CategoryTapEvent {
  currentTarget: { dataset: { category: string } };
}

interface InputEvent {
  detail: { value: string };
}

interface CheckboxEvent {
  detail: { value: string[] };
}

interface ImageTapEvent {
  currentTarget: { dataset: { index: string } };
}

interface FeedbackMethods {
  init(): Promise<void>;
  retryConfig(): void;
  login(): Promise<void>;
  selectCategory(event: CategoryTapEvent): void;
  onContentInput(event: InputEvent): void;
  onContactInput(event: InputEvent): void;
  onPhotoConsentChange(event: CheckboxEvent): void;
  chooseImages(): void;
  previewImage(event: ImageTapEvent): void;
  removeImage(event: ImageTapEvent): void;
  updateImageProgress(index: number, progress: number): void;
  markImageUploaded(index: number, key: string): void;
  clearImageKeys(): void;
  readDeviceInfo(): CreateFeedbackInput['device_info'];
  submit(): Promise<void>;
  onUnload(): void;
}

const CATEGORIES: FeedbackCategoryOption[] = [
  { key: 'bug', label: '问题', desc: '功能异常' },
  { key: 'suggestion', label: '建议', desc: '改进想法' },
  { key: 'content', label: '内容', desc: '信息有误' },
  { key: 'photo', label: '钓点实拍', desc: '补充实景' },
  { key: 'other', label: '其他', desc: '其他反馈' },
];

let successTimer: number | undefined;

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

function clipped(value: string | undefined, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

Page<FeedbackData, FeedbackMethods>({
  data: {
    loadingConfig: true,
    configError: '',
    feedbackEnabled: false,
    sessionReady: false,
    loggingIn: false,
    categories: CATEGORIES,
    category: '',
    content: '',
    contentCount: 0,
    minContentLength: MIN_CONTENT_CODE_POINTS,
    maxContentLength: MAX_CONTENT_CODE_POINTS,
    images: [],
    maxImages: MAX_FEEDBACK_IMAGES,
    contact: '',
    maxContactLength: MAX_CONTACT_LENGTH,
    photoConsent: false,
    photoConsentText: PHOTO_CONSENT_TEXT,
    spotId: '',
    spotName: '',
    pagePath: '',
    submitting: false,
    submitError: '',
  },

  onLoad(options: LoadOptions) {
    const category = decodeOption(options.category);
    this.setData({
      category: isFeedbackCategory(category) ? category : '',
      spotId: decodeOption(options.spot_id),
      spotName: decodeOption(options.spot_name),
      pagePath: decodeOption(options.page),
    });
    void this.init();
  },

  onUnload() {
    if (successTimer !== undefined) {
      clearTimeout(successTimer);
      successTimer = undefined;
    }
  },

  async init(): Promise<void> {
    this.setData({ loadingConfig: true, configError: '' });
    const config = await getClientConfig().catch(() => null);
    if (config === null) {
      this.setData({ loadingConfig: false, configError: '配置加载失败，请重试' });
      return;
    }
    const feedbackEnabled = config.features.feedback === true;
    this.setData({
      loadingConfig: false,
      feedbackEnabled,
      sessionReady: getSession() !== null,
    });
    if (feedbackEnabled) {
      track('feedback_open', {
        category: this.data.category,
        page: this.data.pagePath,
      });
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
    } catch (error) {
      track('ugc_login_fail', { result: 'fail' });
      this.setData({ loggingIn: false });
      wx.showToast({ title: loginFailureText(error), icon: 'none' });
    }
  },

  selectCategory(event: CategoryTapEvent): void {
    const category = event.currentTarget.dataset.category;
    if (!isFeedbackCategory(category) || category === this.data.category) {
      return;
    }
    this.setData({ category, submitError: '' });
  },

  onContentInput(event: InputEvent): void {
    this.setData({
      content: event.detail.value,
      contentCount: contentCodePointCount(event.detail.value),
      submitError: '',
    });
  },

  onContactInput(event: InputEvent): void {
    this.setData({ contact: event.detail.value, submitError: '' });
  },

  onPhotoConsentChange(event: CheckboxEvent): void {
    this.setData({ photoConsent: event.detail.value.includes('photo-consent') });
  },

  chooseImages(): void {
    if (this.data.submitting) {
      return;
    }
    const remaining = MAX_FEEDBACK_IMAGES - this.data.images.length;
    if (remaining <= 0) {
      wx.showToast({ title: `最多上传 ${MAX_FEEDBACK_IMAGES} 张图片`, icon: 'none' });
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
        const images = [...this.data.images, ...additions].slice(0, MAX_FEEDBACK_IMAGES);
        this.setData({ images, submitError: '' });
      },
      fail: (error) => {
        if ((error.errMsg || '').indexOf('cancel') < 0) {
          wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
        }
      },
    });
  },

  previewImage(event: ImageTapEvent): void {
    const index = Number(event.currentTarget.dataset.index);
    const urls = this.data.images.map((image) => image.path);
    if (urls.length === 0) {
      return;
    }
    wx.previewImage({ current: urls[index], urls });
  },

  removeImage(event: ImageTapEvent): void {
    if (this.data.submitting) {
      return;
    }
    const index = Number(event.currentTarget.dataset.index);
    const images = this.data.images.filter((_image, itemIndex) => itemIndex !== index);
    this.setData({ images, submitError: '' });
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

  readDeviceInfo(): CreateFeedbackInput['device_info'] {
    try {
      const info = wx.getSystemInfoSync();
      const deviceInfo: NonNullable<CreateFeedbackInput['device_info']> = {};
      const model = clipped(info.model, 64);
      const system = clipped(info.system, 64);
      const wechatVersion = clipped(info.version, 32);
      const sdkVersion = clipped(info.SDKVersion, 32);
      if (model !== '') {
        deviceInfo.model = model;
      }
      if (system !== '') {
        deviceInfo.system = system;
      }
      if (wechatVersion !== '') {
        deviceInfo.wechat_version = wechatVersion;
      }
      if (sdkVersion !== '') {
        deviceInfo.sdk_version = sdkVersion;
      }
      return Object.keys(deviceInfo).length > 0 ? deviceInfo : undefined;
    } catch {
      return undefined;
    }
  },

  async submit(): Promise<void> {
    if (this.data.submitting) {
      return;
    }
    if (!this.data.feedbackEnabled) {
      wx.showToast({ title: '反馈功能暂未开放', icon: 'none' });
      return;
    }
    if (!this.data.sessionReady) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    const draft: FeedbackDraft = {
      category: this.data.category,
      content: this.data.content,
      contact: this.data.contact,
      image_count: this.data.images.length,
      photo_consent: this.data.photoConsent,
    };
    const validation = validateFeedbackDraft(draft);
    if (!validation.ok) {
      this.setData({ submitError: validation.message });
      return;
    }

    this.setData({ submitting: true, submitError: '' });
    try {
      await ensureSession();
      this.setData({ sessionReady: true });
    } catch (error) {
      this.setData({ submitting: false, sessionReady: getSession() !== null });
      wx.showToast({ title: loginFailureText(error), icon: 'none' });
      return;
    }

    const imageCount = this.data.images.length;
    const images = this.data.images;
    let stage: 'upload' | 'create' = 'upload';
    try {
      const imageKeys: string[] = [];
      for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        if (image === undefined) {
          continue;
        }
        if (image.key.length > 0) {
          imageKeys.push(image.key);
          continue;
        }
        const uploaded = await uploadFeedbackImage(image.path, (progress) => {
          this.updateImageProgress(index, progress);
        });
        this.markImageUploaded(index, uploaded.key);
        imageKeys.push(uploaded.key);
      }

      const input: CreateFeedbackInput = {
        category: draft.category as FeedbackCategory,
        content: draft.content.trim(),
        app_version: CLIENT_VERSION,
      };
      const contact = draft.contact === undefined ? '' : draft.contact.trim();
      if (contact !== '') {
        input.contact = contact;
      }
      if (this.data.pagePath !== '') {
        input.page = this.data.pagePath;
      }
      if (this.data.spotId !== '') {
        input.spot_id = this.data.spotId;
      }
      const deviceInfo = this.readDeviceInfo();
      if (deviceInfo !== undefined) {
        input.device_info = deviceInfo;
      }
      if (imageKeys.length > 0) {
        input.image_keys = imageKeys;
      }

      stage = 'create';
      const result = await createFeedback(input);
      track('feedback_submit', {
        category: input.category,
        result: 'success',
        image_count: imageCount,
      });
      track('feedback_result', {
        category: input.category,
        status: result.status,
      });
      wx.showToast({ title: '已收到，我们会尽快查看', icon: 'none', duration: 1500 });
      successTimer = setTimeout(() => {
        successTimer = undefined;
        wx.navigateBack({ delta: 1 });
      }, 1500);
    } catch (error) {
      if (stage === 'create') {
        // A create attempt may have consumed the uploaded keys; upload again
        // on retry while keeping the local images.
        this.clearImageKeys();
      }
      track('feedback_submit', {
        category: draft.category,
        result: 'fail',
        image_count: imageCount,
      });
      this.setData({
        submitting: false,
        submitError:
          stage === 'upload'
            ? '图片上传失败，已填内容和图片会保留，请重试'
            : error instanceof Error
              ? error.message
              : '提交失败，请重试',
      });
    }
  },
});
