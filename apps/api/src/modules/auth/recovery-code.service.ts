import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PasswordService } from './password.service';

// Unambiguous alphabet: no i, l, o, 0 or 1.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_COUNT = 10;
const GROUP_LENGTH = 4;

export interface GeneratedRecoveryCodes {
  plain: string[];
  hashes: string[];
}

export interface RecoveryCodeResult {
  consumed: boolean;
  remaining: string[];
}

@Injectable()
export class RecoveryCodeService {
  constructor(private readonly passwordService: PasswordService) {}

  async generate(): Promise<GeneratedRecoveryCodes> {
    const plain = Array.from({ length: CODE_COUNT }, () => this.createCode());
    const hashes = await Promise.all(
      plain.map((code) => this.passwordService.hashSecret(code.toLowerCase())),
    );
    return { plain, hashes };
  }

  async consume(code: string, hashes: readonly string[]): Promise<RecoveryCodeResult> {
    const normalized = code.trim().toLowerCase();
    for (let index = 0; index < hashes.length; index += 1) {
      const storedHash = hashes[index];
      if (storedHash === undefined) {
        continue;
      }
      if (await this.passwordService.verify(storedHash, normalized)) {
        return {
          consumed: true,
          remaining: hashes.filter((_value, position) => position !== index),
        };
      }
    }
    return { consumed: false, remaining: [...hashes] };
  }

  private createCode(): string {
    let code = '';
    for (let position = 0; position < GROUP_LENGTH * 2; position += 1) {
      if (position === GROUP_LENGTH) {
        code += '-';
      }
      const character = ALPHABET[randomInt(ALPHABET.length)];
      if (character === undefined) {
        throw new Error('Recovery code alphabet is empty');
      }
      code += character;
    }
    return code;
  }
}
