declare module 'ali-oss' {
  interface OSSOptions {
    region: string;
    accessKeyId: string;
    accessKeySecret: string;
    bucket: string;
  }

  interface PutOptions {
    mime?: string;
  }

  interface SignatureUrlOptions {
    expires: number;
  }

  interface GetResult {
    content: Buffer;
  }

  class OSS {
    constructor(options: OSSOptions);
    put(name: string, file: Buffer, options?: PutOptions): Promise<unknown>;
    copy(name: string, sourceName: string): Promise<unknown>;
    delete(name: string): Promise<unknown>;
    signatureUrl(name: string, options: SignatureUrlOptions): string;
    get(name: string): Promise<GetResult>;
  }

  export default OSS;
}
