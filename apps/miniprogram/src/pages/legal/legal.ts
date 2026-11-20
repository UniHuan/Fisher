interface LoadOptions {
  url?: string;
}

interface LegalData {
  url: string;
  failed: boolean;
}

interface LegalMethods {
  onWebViewError(): void;
  copyLink(): void;
  retry(): void;
}

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

Page<LegalData, LegalMethods>({
  data: {
    url: '',
    failed: false,
  },

  onLoad(options: LoadOptions) {
    const url = decodeOption(options.url);
    const valid = url.indexOf('https://') === 0 || url.indexOf('http://') === 0;
    this.setData({ url, failed: !valid });
  },

  onWebViewError() {
    this.setData({ failed: true });
  },

  copyLink() {
    if (this.data.url === '') {
      return;
    }
    wx.setClipboardData({
      data: this.data.url,
      success: () => {
        wx.showToast({ title: '链接已复制', icon: 'success' });
      },
    });
  },

  retry() {
    if (this.data.url !== '') {
      this.setData({ failed: false });
    }
  },
});
