import { ParserService } from 'src/snapshot/parser/parser.service';
import { SolanaService } from 'src/solana/solana.service';

const registrarData = Buffer.from([1, 2, 3]);

const solanaServiceReturning = (accountInfo: { data: Buffer } | null) =>
  ({
    connection: { getAccountInfo: async () => accountInfo },
  }) as unknown as SolanaService;

describe('ParserService.getFilters', () => {
  it('emits exactly the keys snapshot-parser-tokens-cli deserializes', async () => {
    const service = new ParserService(
      solanaServiceReturning({ data: registrarData }),
    );

    const filters = await service.getFilters();

    expect(Object.keys(filters).sort()).toEqual([
      'account_mints',
      'vsr_registrar_data',
    ]);
    expect(filters.account_mints).toEqual(
      'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
    );
    expect(filters.vsr_registrar_data).toEqual(
      registrarData.toString('base64'),
    );
  });

  it('fails when the VSR registrar cannot be read', async () => {
    const service = new ParserService(solanaServiceReturning(null));

    await expect(service.getFilters()).rejects.toThrow(
      'Failed to get VSR Registrar Data!',
    );
  });
});
