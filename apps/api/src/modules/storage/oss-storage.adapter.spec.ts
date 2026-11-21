import OSS from 'ali-oss';
import { OssStorageAdapter } from './oss-storage.adapter';

jest.mock('ali-oss', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    put: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    copy: jest.fn().mockResolvedValue(undefined),
    signatureUrl: jest.fn(),
    head: jest.fn().mockResolvedValue(undefined),
  })),
}));

const OSSMock = OSS as unknown as jest.Mock;

describe('OssStorageAdapter', () => {
  beforeEach(() => {
    OSSMock.mockClear();
  });

  it('copies objects from the work bucket to the public bucket', async () => {
    const adapter = new OssStorageAdapter({
      region: 'oss-cn-shenzhen',
      accessKeyId: 'test-id',
      accessKeySecret: 'test-secret',
      workBucket: 'work-bucket',
      publicBucket: 'public-bucket',
      publicBaseUrl: 'https://static.example.com/',
    });

    await adapter.copyObject('spots/a.jpg', 'spots/a.jpg');

    const publicClient = OSSMock.mock.results[1]?.value;
    expect(publicClient.copy).toHaveBeenCalledWith(
      'spots/a.jpg',
      'spots/a.jpg',
      'work-bucket',
    );
  });

  it('reports a missing object only for a confirmed not-found response', async () => {
    const adapter = new OssStorageAdapter({
      region: 'oss-cn-shenzhen',
      accessKeyId: 'test-id',
      accessKeySecret: 'test-secret',
      workBucket: 'work-bucket',
      publicBucket: 'public-bucket',
      publicBaseUrl: 'https://static.example.com/',
    });
    const workClient = OSSMock.mock.results[0]?.value;

    workClient.head.mockResolvedValueOnce({});
    await expect(adapter.objectExists('products/a.webp', 'working')).resolves.toBe(true);

    workClient.head.mockRejectedValueOnce({ status: 404, code: 'NoSuchKey' });
    await expect(adapter.objectExists('products/a.webp', 'working')).resolves.toBe(false);
  });

  it('rethrows NoSuchBucket and generic 404 responses instead of reporting a missing object', async () => {
    const adapter = new OssStorageAdapter({
      region: 'oss-cn-shenzhen',
      accessKeyId: 'test-id',
      accessKeySecret: 'test-secret',
      workBucket: 'work-bucket',
      publicBucket: 'public-bucket',
      publicBaseUrl: 'https://static.example.com/',
    });
    const workClient = OSSMock.mock.results[0]?.value;

    const noSuchBucket = { status: 404, code: 'NoSuchBucket', name: 'NoSuchBucket' };
    workClient.head.mockRejectedValueOnce(noSuchBucket);
    await expect(adapter.objectExists('products/a.webp', 'working')).rejects.toEqual(
      noSuchBucket,
    );

    const maskedNotFound = { status: 404, code: 'AccessDenied' };
    workClient.head.mockRejectedValueOnce(maskedNotFound);
    await expect(adapter.objectExists('products/a.webp', 'working')).rejects.toEqual(
      maskedNotFound,
    );
  });

  it('rethrows a storage failure that is not a not-found response', async () => {
    const adapter = new OssStorageAdapter({
      region: 'oss-cn-shenzhen',
      accessKeyId: 'test-id',
      accessKeySecret: 'test-secret',
      workBucket: 'work-bucket',
      publicBucket: 'public-bucket',
      publicBaseUrl: 'https://static.example.com/',
    });
    const workClient = OSSMock.mock.results[0]?.value;

    workClient.head.mockRejectedValueOnce({ status: 503, code: 'ServiceUnavailable' });
    await expect(adapter.objectExists('products/a.webp', 'working')).rejects.toEqual({
      status: 503,
      code: 'ServiceUnavailable',
    });
  });
});
