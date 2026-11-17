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

interface WxOpenSettingOptions {
  success?: (result: { authSetting: Record<string, boolean> }) => void;
  fail?: (error: { errMsg: string }) => void;
}

declare const wx: {
  request(options: WxRequestOptions): void;
  getLocation(options: WxGetLocationOptions): void;
  openLocation(options: WxOpenLocationOptions): void;
  showToast(options: WxShowToastOptions): void;
  setClipboardData(options: WxSetClipboardOptions): void;
  previewImage(options: WxPreviewImageOptions): void;
  navigateTo(options: WxNavigateOptions): void;
  switchTab(options: WxNavigateOptions): void;
  stopPullDownRefresh(): void;
  openSetting(options?: WxOpenSettingOptions): void;
};

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
