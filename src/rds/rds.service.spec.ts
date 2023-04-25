import { Test, TestingModule } from '@nestjs/testing';
import { RdsService } from './rds.service';

describe('RdsService', () => {
  let service: RdsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RdsService],
    }).compile();

    service = module.get<RdsService>(RdsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
