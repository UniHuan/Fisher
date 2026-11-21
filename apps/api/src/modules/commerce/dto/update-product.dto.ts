import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PRODUCT_STATUS } from '@szfisher/shared';
import { CreateProductDto } from './create-product.dto';

const STATUSES: string[] = Object.values(PRODUCT_STATUS);

export class UpdateProductDto extends PartialType(CreateProductDto) {
  @ApiPropertyOptional({
    enum: STATUSES,
    example: PRODUCT_STATUS.ACTIVE,
    description:
      'Draft to active publishes the current image set before the status changes.',
  })
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;
}
