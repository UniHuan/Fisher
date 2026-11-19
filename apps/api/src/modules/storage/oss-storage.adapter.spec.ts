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
});
