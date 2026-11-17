import { Controller, Get, Header, HttpStatus, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES } from '@szfisher/shared';
import { ApiClientHeaders } from '../../common/openapi/client-headers.decorator';
import {
  ApiCommonErrorResponses,
  ApiEnvelopeResponse,
  ApiErrorResponse,
} from '../../common/openapi/api-response.decorators';
import { PublicSpotListQueryDto } from './dto/public-spot-list-query.dto';
import { PublicMapQueryDto } from './dto/public-map-query.dto';
import { PublicPoiQueryDto } from './dto/public-poi-query.dto';
import {
  PublicMapResponseDto,
  PublicPoiListDto,
  PublicSpotDetailDto,
  PublicSpotPageDto,
} from './dto/public-spot-response.dto';
import { PublicSpotsService } from './public-spots.service';

const SPOT_ID_PARAM = {
  name: 'id',
  description: 'Spot ULID',
  example: '01HX0000000000000000000000',
};

@ApiTags('public spots')
@ApiClientHeaders()
@ApiCommonErrorResponses([ERROR_CODES.VALIDATION, ERROR_CODES.NOT_FOUND, ERROR_CODES.INTERNAL])
@Controller('spots')
export class PublicSpotsController {
  constructor(private readonly spots: PublicSpotsService) {}

  @Get()
  @ApiOperation({ summary: 'List published spots with filters, search and sorting' })
  @ApiEnvelopeResponse(PublicSpotPageDto, { description: 'Paginated published spots' })
  list(@Query() query: PublicSpotListQueryDto) {
    return this.spots.list(query);
  }

  @Get('map')
  @Header('Cache-Control', 'public, max-age=30')
  @ApiOperation({ summary: 'Return lightweight published spot map points or clusters' })
  @ApiEnvelopeResponse(PublicMapResponseDto, { description: 'Map points or grid clusters' })
  map(@Query() query: PublicMapQueryDto) {
    return this.spots.map(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a published spot detail' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiEnvelopeResponse(PublicSpotDetailDto, { description: 'Published spot detail' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot is not published or does not exist (40401)')
  detail(@Param('id') id: string) {
    return this.spots.detail(id);
  }

  @Get(':id/pois')
  @ApiOperation({ summary: 'List nearby POIs for a published spot' })
  @ApiParam(SPOT_ID_PARAM)
  @ApiEnvelopeResponse(PublicPoiListDto, { description: 'POIs ordered by distance' })
  @ApiErrorResponse(HttpStatus.NOT_FOUND, 'Spot is not published or does not exist (40401)')
  pois(@Param('id') id: string, @Query() query: PublicPoiQueryDto) {
    return this.spots.pois(id, query);
  }
}
