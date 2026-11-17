import { PartialType } from '@nestjs/swagger';
import { CreateSpotDto } from './create-spot.dto';

/** Every field is optional; the service enforces spot_name and published invariants. */
export class UpdateSpotDto extends PartialType(CreateSpotDto) {}
