import { track } from './analytics';
import {
  fetchProductCards,
  mediaUrl,
  type ProductCard,
  type ProductCardQuery,
  type ProductChannelCard,
  type PurchaseAction,
} from './api';

export const SPOT_DETAIL_SURFACE = 'spot_detail';

const H5_TOAST = '链接已复制，请在浏览器打开';
const COPY_TOAST = '链接已复制';
const OPEN_FAIL_TOAST = '打开失败，请稍后重试';
const COPY_FAIL_TOAST = '复制失败，请稍后重试';
const PRICE_FALLBACK = '以微店页面为准';

const CATEGORY_LABELS: Record<string, string> = {
  rod: '竿',
  reel: '轮',
  line: '线',
  bait: '饵',
  hat: '帽子',
  sun_protection: '防晒',
  accessory: '配件',
  other: '其他',
};

export interface PurchaseActionContext {
  product_id?: string;
  channel?: string;
}

export interface ProductCardView {
  product_id: string;
  title: string;
  subtitle: string;
  image_url: string;
  channel: string;
  channelLabel: string;
  priceText: string;
  purchaseAction: PurchaseAction;
}

export function productCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? CATEGORY_LABELS.other ?? '';
}

/** Loads product cards for a surface; a failure hides the section instead of raising. */
export async function loadProductCards(query: ProductCardQuery): Promise<ProductCard[]> {
  try {
    const result = await fetchProductCards(query);
    return result.items;
  } catch {
    return [];
  }
}

/** Resolves URLs for the card component and keeps one channel for V1. */
export function toProductCardView(card: ProductCard): ProductCardView {
  const channel: ProductChannelCard | undefined = card.channels[0];
  return {
    product_id: card.product_id,
    title: card.title,
    subtitle: card.subtitle ?? '',
    image_url: mediaUrl(card.image_url),
    channel: channel?.channel ?? '',
    channelLabel: channel?.label ?? '',
    priceText: channel?.price_display ?? PRICE_FALLBACK,
    purchaseAction: channel?.purchase_action ?? { type: 'copy_link' },
  };
}

function trackActionOpen(actionType: string, context: PurchaseActionContext): void {
  track('purchase_action_open', {
    action_type: actionType,
    channel: context.channel ?? '',
    product_id: context.product_id ?? '',
  });
}

function trackActionFail(
  actionType: string,
  context: PurchaseActionContext,
  reason: string,
): void {
  track('purchase_action_fail', {
    action_type: actionType,
    channel: context.channel ?? '',
    product_id: context.product_id ?? '',
    reason,
  });
}

function copyUrl(
  actionType: string,
  url: string | undefined,
  toast: string,
  context: PurchaseActionContext,
  trackOpen = true,
): void {
  if (url === undefined || url.length === 0) {
    trackActionFail(actionType, context, 'missing_url');
    wx.showToast({ title: OPEN_FAIL_TOAST, icon: 'none' });
    return;
  }
  if (trackOpen) {
    trackActionOpen(actionType, context);
  }
  wx.setClipboardData({
    data: url,
    success: () => {
      wx.showToast({ title: toast, icon: 'none' });
    },
    fail: () => {
      trackActionFail(actionType, context, 'clipboard_fail');
      wx.showToast({ title: COPY_FAIL_TOAST, icon: 'none' });
    },
  });
}

/**
 * Executes a channel purchase action outside the mini program. Missing fields
 * fail with a toast and never throw, so a malformed card cannot break the page.
 */
export function openPurchaseAction(
  action: PurchaseAction | null | undefined,
  context: PurchaseActionContext = {},
): void {
  if (action === null || action === undefined) {
    return;
  }
  if (action.type === 'mini_program') {
    const appId = action.app_id;
    const path = action.path;
    if (
      typeof appId !== 'string' ||
      appId.length === 0 ||
      typeof path !== 'string' ||
      path.length === 0
    ) {
      trackActionFail(action.type, context, 'missing_target');
      wx.showToast({ title: OPEN_FAIL_TOAST, icon: 'none' });
      return;
    }
    trackActionOpen(action.type, context);
    wx.navigateToMiniProgram({
      appId,
      path,
      fail: () => {
        if (typeof action.fallback_url === 'string' && action.fallback_url.length > 0) {
          // The fallback continues the same open attempt, so do not count it twice.
          copyUrl(action.type, action.fallback_url, H5_TOAST, context, false);
          return;
        }
        trackActionFail(action.type, context, 'navigate_fail');
        wx.showToast({ title: OPEN_FAIL_TOAST, icon: 'none' });
      },
    });
    return;
  }
  if (action.type === 'h5') {
    copyUrl(action.type, action.url, H5_TOAST, context);
    return;
  }
  const toast =
    typeof action.toast === 'string' && action.toast.length > 0 ? action.toast : COPY_TOAST;
  copyUrl(action.type, action.url, toast, context);
}
