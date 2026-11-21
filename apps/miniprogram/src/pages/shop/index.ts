import { track } from '../../analytics';
import { getClientConfig, type ProductCategory } from '../../api';
import {
  loadProductCards,
  openPurchaseAction,
  productCategoryLabel,
  toProductCardView,
  type ProductCardView,
} from '../../commerce';

type CategoryKey = 'all' | ProductCategory;

interface CategoryOption {
  key: CategoryKey;
  label: string;
}

interface ShopData {
  initialized: boolean;
  configError: string;
  shopEnabled: boolean;
  categories: CategoryOption[];
  category: CategoryKey;
  products: ProductCardView[];
  loading: boolean;
  requestSeq: number;
}

interface CategoryTapEvent {
  currentTarget: { dataset: { key: string } };
}

interface ProductTapEvent {
  currentTarget: { dataset: { id: string } };
}

interface ShopMethods {
  init(): Promise<void>;
  retryConfig(): void;
  loadProducts(): Promise<void>;
  selectCategory(event: CategoryTapEvent): void;
  openProduct(event: ProductTapEvent): void;
}

const SHOP_CATEGORY_KEYS: ProductCategory[] = [
  'rod',
  'reel',
  'line',
  'bait',
  'hat',
  'sun_protection',
  'accessory',
];

const SHOP_CATEGORIES: CategoryOption[] = [
  { key: 'all', label: '全部' },
  ...SHOP_CATEGORY_KEYS.map((key) => ({ key, label: productCategoryLabel(key) })),
];

Page<ShopData, ShopMethods>({
  data: {
    initialized: false,
    configError: '',
    shopEnabled: false,
    categories: SHOP_CATEGORIES,
    category: 'all',
    products: [],
    loading: false,
    requestSeq: 0,
  },

  onLoad() {
    void this.init();
  },

  async init(): Promise<void> {
    const config = await getClientConfig().catch(() => null);
    const shopEnabled = config?.features.shop === true;
    this.setData({
      initialized: true,
      shopEnabled,
      configError: config === null ? '配置加载失败，请重试' : '',
    });
    if (!shopEnabled) {
      return;
    }
    track('shop_open');
    await this.loadProducts();
  },

  retryConfig(): void {
    void this.init();
  },

  async loadProducts(): Promise<void> {
    const seq = this.data.requestSeq + 1;
    this.setData({ requestSeq: seq, loading: true });
    const category = this.data.category;
    const cards = await loadProductCards({
      surface: 'brand_page',
      category: category === 'all' ? undefined : category,
    });
    if (this.data.requestSeq !== seq) {
      return;
    }
    const products = cards.map((card) => toProductCardView(card));
    this.setData({ products, loading: false });
    for (const product of products) {
      track('product_impression', {
        product_id: product.product_id,
        surface: 'brand_page',
        target_id: '',
        channel: product.channel,
      });
    }
  },

  selectCategory(event: CategoryTapEvent): void {
    const option = SHOP_CATEGORIES.find(
      (item) => item.key === event.currentTarget.dataset.key,
    );
    if (option === undefined || option.key === this.data.category) {
      return;
    }
    this.setData({ category: option.key });
    void this.loadProducts();
  },

  openProduct(event: ProductTapEvent): void {
    const product = this.data.products.find(
      (item) => item.product_id === event.currentTarget.dataset.id,
    );
    if (product === undefined) {
      return;
    }
    track('product_click', {
      product_id: product.product_id,
      surface: 'brand_page',
      target_id: '',
      channel: product.channel,
    });
    openPurchaseAction(product.purchaseAction, {
      product_id: product.product_id,
      channel: product.channel,
    });
  },
});
