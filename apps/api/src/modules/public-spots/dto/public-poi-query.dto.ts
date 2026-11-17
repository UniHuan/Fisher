import { ApiPropertyOptional } from '@nestjs/swagger';
import { POI_TYPE } from '@szfisher/shared';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class PublicPoiQueryDto {
  @ApiPropertyOptional({ enum: Object.values(POI_TYPE), example: 'food' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  @IsIn(Object.values(POI_TYPE))
  poi_type?: string;
}
