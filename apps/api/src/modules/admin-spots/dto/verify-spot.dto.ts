import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

export class VerifySpotDto {
  @ApiPropertyOptional({ maxLength: 32, example: '现场' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  method?: string;

  @ApiPropertyOptional({ maxLength: 200, example: '水情稳定' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  note?: string;
}
