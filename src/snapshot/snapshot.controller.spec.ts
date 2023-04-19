import { Test, TestingModule } from '@nestjs/testing';
import { SnapshotController } from './snapshot.controller';

describe('SnapshotController', () => {
  let controller: SnapshotController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SnapshotController],
    }).compile();

    controller = module.get<SnapshotController>(SnapshotController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
