import { IsString, Length } from 'class-validator';

export class LoginDto {
  @IsString()
  @Length(1, 64)
  username!: string;

  // No minimum here: wrong passwords of any length must reach argon2 and the generic 401.
  @IsString()
  @Length(1, 128)
  password!: string;
}
