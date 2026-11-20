import { ApiProperty } from '@nestjs/swagger';

export class AppUserDto {
  @ApiProperty({ type: String, nullable: true, example: '钓友 A7K2' })
  nickname!: string | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  avatar_url!: string | null;
}

/** Successful login and refresh body. */
export class AppSessionDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  access_token!: string;

  @ApiProperty({ example: 'v1.01HX0000000000000000000000.random.signature' })
  refresh_token!: string;

  @ApiProperty({ example: 'Bearer' })
  token_type!: string;

  @ApiProperty({ type: 'integer', example: 7200 })
  expires_in!: number;

  @ApiProperty({ type: () => AppUserDto })
  user!: AppUserDto;
}
