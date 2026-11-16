import { Injectable, type OnModuleInit } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 12;

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHashPromise?: Promise<string>;

  async onModuleInit(): Promise<void> {
    // Pay the hashing cost once at startup so unknown usernames verify with the same latency.
    this.dummyHashPromise = this.createDummyHash();
    await this.dummyHashPromise;
  }

  /** Hashes an operator password. Passwords below the PRD minimum are rejected. */
  async hash(password: string): Promise<string> {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Admin passwords must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    return hash(password, { type: argon2id });
  }

  /** Hashes a non-password secret such as a recovery code without a length policy. */
  async hashSecret(secret: string): Promise<string> {
    return hash(secret, { type: argon2id });
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Always resolves false after doing real argon2 work, to hide unknown usernames. */
  async verifyDummy(password: string): Promise<boolean> {
    const dummyHash = await this.getDummyHash();
    await this.verify(dummyHash, password);
    return false;
  }

  private getDummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = this.createDummyHash();
    }
    return this.dummyHashPromise;
  }

  private createDummyHash(): Promise<string> {
    return hash(randomBytes(32).toString('base64url'), { type: argon2id });
  }
}
