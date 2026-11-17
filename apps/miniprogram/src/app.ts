import { track } from './analytics';

let firstShow = true;

App({
  onLaunch(options: WxLaunchOptions) {
    track('app_launch', {
      scene: options.scene ?? 0,
      page: options.path ?? '',
    });
  },

  onShow(options: WxLaunchOptions) {
    // The first onShow follows onLaunch; later ones are resumes from background.
    if (firstShow) {
      firstShow = false;
      return;
    }
    track('app_launch', {
      scene: options.scene ?? 0,
      page: options.path ?? '',
      restored: true,
    });
  },
});
