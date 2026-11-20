import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ example: 'v1.01HX0000000000000000000000.random.signature', maxLength: 512 })
  @IsString()
  @Length(1, 512)
  refresh_token!: string;
}
