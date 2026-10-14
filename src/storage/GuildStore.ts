import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger } from '../logger.js';

export interface GuildData {
  /** Sala de voz configurada via /config sala. */
  voiceChannelId?: string;
  /**
   * Usuários que o bot mutou e ainda não desmutou. Persistido para que ninguém fique
   * mutado para sempre se o bot cair ou se a pessoa sair da chamada durante o Pomodoro.
   */
  mutedByBot: string[];
  /** Apelido original do bot enquanto um Pomodoro está ativo (null = sem apelido). */
  nicknameBackup?: { value: string | null };
  /** Sala cujo status o bot definiu e ainda precisa limpar. */
  voiceStatusChannelId?: string;
}

interface StoreShape {
  guilds: Record<string, GuildData>;
  /** Hash do último avatar enviado, para só trocar quando a imagem mudar. */
  avatarHash?: string;
}

/** Armazenamento simples em JSON com escrita atômica e serializada. */
export class GuildStore {
  private data: StoreShape = { guilds: {} };
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreShape>;
      this.data = { guilds: parsed.guilds ?? {}, avatarHash: parsed.avatarHash };
      for (const guild of Object.values(this.data.guilds)) guild.mutedByBot ??= [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(`Falha ao ler ${this.filePath}; iniciando com dados vazios.`, error);
      }
    }
  }

  get(guildId: string): GuildData {
    return (this.data.guilds[guildId] ??= { mutedByBot: [] });
  }

  get avatarHash(): string | undefined {
    return this.data.avatarHash;
  }

  async setAvatarHash(hash: string): Promise<void> {
    this.data.avatarHash = hash;
    await this.flush();
  }

  guildIds(): string[] {
    return Object.keys(this.data.guilds);
  }

  async update(guildId: string, mutate: (data: GuildData) => void): Promise<void> {
    mutate(this.get(guildId));
    await this.flush();
  }

  isMutedByBot(guildId: string, userId: string): boolean {
    return this.data.guilds[guildId]?.mutedByBot.includes(userId) ?? false;
  }

  async addMuted(guildId: string, userId: string): Promise<void> {
    if (this.isMutedByBot(guildId, userId)) return;
    await this.update(guildId, (g) => g.mutedByBot.push(userId));
  }

  async removeMuted(guildId: string, userId: string): Promise<void> {
    if (!this.isMutedByBot(guildId, userId)) return;
    await this.update(guildId, (g) => {
      g.mutedByBot = g.mutedByBot.filter((id) => id !== userId);
    });
  }

  private flush(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        await writeFile(tmp, snapshot, 'utf8');
        await rename(tmp, this.filePath);
      })
      .catch((error) => logger.error('Falha ao salvar o armazenamento.', error));
    return this.writeQueue;
  }
}
