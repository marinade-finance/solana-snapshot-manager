import { Test, TestingModule } from '@nestjs/testing';
import { VotesController } from './votes.controller';

describe('VotesController', () => {
  let controller: VotesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VotesController],
    }).compile();

    controller = module.get<VotesController>(VotesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
