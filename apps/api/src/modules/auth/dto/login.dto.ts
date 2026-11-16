import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'operator01', maxLength: 64 })
  @IsString()
  @Length(1, 64)
  username!: string;

  // No minimum here: wrong passwords of any length must reach argon2 and the generic 401.
  @ApiProperty({ example: 'correct horse battery staple', maxLength: 128 })
  @IsString()
  @Length(1, 128)
  password!: string;
}
