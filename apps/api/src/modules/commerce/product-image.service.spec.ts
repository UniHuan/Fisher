import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../audit/audit-log.service';
import { StorageService } from '../storage/storage.service';
import type { StorageAdapter } from '../storage/storage.types';
import type { ImageProcessorService } from '../uploads/image-processor.service';
import type { PreviewSignerService } from '../uploads/preview-signer.service';
import { ProductImageService } from './product-image.service';

const PRODUCT_ID = '01HX0000000000000000000000';
const PRESENT_KEY = `products/${PRODUCT_ID}/01HX0000000000000000000001.webp`;
const MISSING_KEY = `products/${PRODUCT_ID}/01HX0000000000000000000002.webp`;

function fakeAdapter(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    putObject: jest.fn().mockResolvedValue(undefined),
    copyObject: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
    deletePublishedObject: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue(''),
    getPublicUrl: jest.fn().mockReturnValue(''),
    getObject: jest.fn().mockResolvedValue(Buffer.alloc(0)),
    objectExists: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function buildService(adapter: StorageAdapter, imageKeys: string[]): ProductImageService {
  const prisma = {
    product: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ product_id: PRODUCT_ID, image_keys: imageKeys }),
    },
  } as unknown as PrismaService;

  return new ProductImageService(
    prisma,
    new StorageService(adapter),
    {} as ImageProcessorService,
    {} as PreviewSignerService,
    { record: jest.fn() } as unknown as AuditLogService,
  );
}

describe('ProductImageService.publishForProduct', () => {
  it('skips an object confirmed missing and copies the remaining keys', async () => {
    const objectExists = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const copyObject = jest.fn().mockResolvedValue(undefined);
    const adapter = fakeAdapter({ objectExists, copyObject });
    const service = buildService(adapter, [MISSING_KEY, PRESENT_KEY]);

    await expect(service.publishForProduct(PRODUCT_ID)).resolves.toBeUndefined();

    expect(objectExists.mock.calls).toEqual([
      [MISSING_KEY, 'working'],
      [PRESENT_KEY, 'working'],
    ]);
    expect(copyObject).toHaveBeenCalledTimes(1);
    expect(copyObject).toHaveBeenCalledWith(PRESENT_KEY, PRESENT_KEY);
  });

  it('rejects instead of skipping when the existence check fails for another reason', async () => {
    const copyObject = jest.fn().mockResolvedValue(undefined);
    const adapter = fakeAdapter({
      objectExists: jest.fn().mockRejectedValue(new Error('storage unavailable')),
      copyObject,
    });
    const service = buildService(adapter, [PRESENT_KEY]);

    await expect(service.publishForProduct(PRODUCT_ID)).rejects.toThrow('storage unavailable');
    expect(copyObject).not.toHaveBeenCalled();
  });

  it('rejects when copying an existing key fails', async () => {
    const adapter = fakeAdapter({
      objectExists: jest.fn().mockResolvedValue(true),
      copyObject: jest.fn().mockRejectedValue(new Error('copy denied')),
    });
    const service = buildService(adapter, [PRESENT_KEY]);

    await expect(service.publishForProduct(PRODUCT_ID)).rejects.toThrow(
      'Image publishing failed',
    );
  });
});
