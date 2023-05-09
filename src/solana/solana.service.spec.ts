import { Test, TestingModule } from '@nestjs/testing';
import { SolanaService } from './solana.service';

describe('SolanaService', () => {
  let service: SolanaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SolanaService],
    }).compile();

    service = module.get<SolanaService>(SolanaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
