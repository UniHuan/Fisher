interface WxResponse {
  data: unknown;
  statusCode: number;
  header: Record<string, string>;
}

interface WxRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: unknown;
  header?: Record<string, string>;
  timeout?: number;
  success?: (response: WxResponse) => void;
  fail?: (error: { errMsg: string }) => void;
}

interface WxLocation {
  latitude: number;
  longitude: number;
}

interface WxGetLocationOptions {
  type?: 'gcj02' | 'wgs84';
  success?: (location: WxLocation) => void;
  fail?: (error: { errMsg: string }) => void;
}

interface WxOpenLocationOptions {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  scale?: number;
  success?: () => void;
  fail?: (error: { errMsg: string }) => void;
}

interface WxShowToastOptions {
  title: string;
  icon?: 'none' | 'success' | 'error';
  duration?: number;
}

interface WxSetClipboardOptions {
  data: string;
  success?: () => void;
  fail?: (error: { errMsg: string }) => void;
}

interface WxPreviewImageOptions {
  current?: string;
  urls: string[];
}

interface WxNavigateOptions {
  url: string;
}

interface WxNavigateBackOptions {
  delta?: number;
}

interface WxLoginOptions {
  success?: (result: { code?: string; errMsg?: string }) => void;
  fail?: (error: { errMsg: string }) => void;
}

interface WxShowModalOptions {
  title?: string;
  content?: string;
  showCancel?: boolean;
  cancelText?: string;
  confirmText?: string;
  success?: (result: { confirm: boolean; cancel: boolean }) => void;
  fail?: (error: { errMsg: string }) => void;
}

interface WxAlertBeforeUnloadOptions {
  message: string;
}

interface WxOpenSettingOptions {
  success?: (result: { authSetting: Record<string, boolean> }) => void;
  fail?: (error: { errMsg: string }) => void;
}

interface WxSystemInfo {
  platform?: string;
  system?: string;
  version?: string;
  SDKVersion?: string;
}

interface WxAccountInfo {
  miniProgram?: {
    version?: string;
    envVersion?: string;
  };
}

interface WxLaunchOptions {
  scene?: number;
  path?: string;
  query?: Record<string, string>;
}

interface WxPageInstance {
  route?: string;
}

declare const wx: {
  request(options: WxRequestOptions): void;
  login(options: WxLoginOptions): void;
  getLocation(options: WxGetLocationOptions): void;
  openLocation(options: WxOpenLocationOptions): void;
  showToast(options: WxShowToastOptions): void;
  showModal(options: WxShowModalOptions): void;
  setClipboardData(options: WxSetClipboardOptions): void;
  previewImage(options: WxPreviewImageOptions): void;
  navigateTo(options: WxNavigateOptions): void;
  navigateBack(options?: WxNavigateBackOptions): void;
  switchTab(options: WxNavigateOptions): void;
  enableAlertBeforeUnload(options: WxAlertBeforeUnloadOptions): void;
  disableAlertBeforeUnload(): void;
  stopPullDownRefresh(): void;
  openSetting(options?: WxOpenSettingOptions): void;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, data: unknown): void;
  removeStorageSync(key: string): void;
  reportAnalytics(eventName: string, data: Record<string, string | number>): void;
  getSystemInfoSync(): WxSystemInfo;
  getAccountInfoSync(): WxAccountInfo;
};

declare function getCurrentPages(): WxPageInstance[];

interface PageInstance<TData> {
  data: TData;
  setData(data: Partial<TData> & Record<string, unknown>, callback?: () => void): void;
}

declare function Page<TData extends object, TMethods extends object = object>(
  options: { data: TData } & TMethods & Record<string, unknown> &
    ThisType<PageInstance<TData> & TMethods>,
): void;

declare function App(options: Record<string, unknown>): void;

declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(id: number): void;
