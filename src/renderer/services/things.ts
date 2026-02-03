import { ContentRef, Storage } from './storage';
import { Stock } from '@/types/stock';

const SETTING_FILE_PATH = 'store/setting.json';
const STAR_SITES_FILE_PATH = 'store/star_sites.json';
const STOCK_SETTINGS_FILE_PATH = 'store/stock_settings.json';
const BOOKS_FILE_PATH = 'store/books.json';
const TRADINGS_FILE_PATH = 'store/tradings.json';
const TRAININGS_FILE_PATH = 'store/trainings.json';
const KTRAININGS_FILE_PATH = 'store/ktrainings.json';
const STRATEGY_GROUPS_FILE_PATH = 'store/strategy_groups.json';
class ThingsStorage {
  storage: Storage;

  constructor(storage: Storage) {
    this.storage = storage;
  }

  async Read(path: string, defaults: any = null) {
    console.log('Read', path);
    try {
      const ref: ContentRef = await this.storage.ref(path);
      return (await ref.load()) as unknown as {
        lastModified: string;
        data: Site.FavorItem[];
      };
    } catch (error: any) {
      console.error('Read error:', path, error);
      if (error.code === 404) {
        // 文件不存在，返回默认内容
        return {
          lastModified: '1970-01-01 00:00:00',
          data: defaults,
        };
      }
      return null;
    }
  }

  async Write(path: string, data: any, lastModified: string) {
    console.log('Write', lastModified, data);
    try {
      const ref = await this.storage.ref(path);
      return await ref.save({
        lastModified,
        data,
      });
    } catch (error) {
      return null;
    }
  }

  async ReadRemoteSetting() {
    return this.Read(SETTING_FILE_PATH);
  }

  async WriteRemoteSetting(data: Record<string, any>, lastModified: string) {
    return this.Write(SETTING_FILE_PATH, data, lastModified);
  }

  async ReadRemoteStarSites() {
    return this.Read(STAR_SITES_FILE_PATH);
  }

  async WriteRemoteStarSites(data: Site.FavorItem[], lastModified: string) {
    return this.Write(STAR_SITES_FILE_PATH, data, lastModified);
  }

  async ReadRemoteKTraining() {
    return this.Read(KTRAININGS_FILE_PATH);
  }

  async WriteRemoteKTraining(data: Training.Record[], lastModified: string) {
    return this.Write(KTRAININGS_FILE_PATH, data, lastModified);
  }

  async ReadRemoteStocks() {
    return this.Read(STOCK_SETTINGS_FILE_PATH);
  }

  async WriteRemoteStocks(data: Stock.SettingItem[], lastModified: string) {
    return this.Write(STOCK_SETTINGS_FILE_PATH, data, lastModified);
  }

  async ReadRemoteTradings() {
    return this.Read(TRADINGS_FILE_PATH);
  }

  async WriteRemoteTradings(data: Stock.DoTradeItem[], lastModified: string) {
    return this.Write(TRADINGS_FILE_PATH, data, lastModified);
  }

  async ReadRemoteTrainings() {
    return this.Read(TRAININGS_FILE_PATH);
  }

  async WriteRemoteTrainings(data: Stock.QuantActionItem[], lastModified: string) {
    return this.Write(TRAININGS_FILE_PATH, data, lastModified);
  }

  async ReadRemoteBooks() {
    return this.Read(BOOKS_FILE_PATH);
  }

  async WriteRemoteBooks(data: Note.BookItem[], lastModified: string) {
    return this.Write(BOOKS_FILE_PATH, data, lastModified);
  }

  async ReadRemoteNote(bookId: number, noteId: number | string) {
    const notePath = `store/note_${bookId}_${noteId}.json`;
    return this.Read(notePath);
  }

  async WriteRemoteNote(bookId: number, data: Note.NoteContentItem) {
    const notePath = `store/note_${bookId}_${data.id}.json`;
    return this.Write(notePath, data, data.modifiedTime);
  }

  async ReadRemoteStrategyGroups() {
    return this.Read(STRATEGY_GROUPS_FILE_PATH);
  }

  async WriteRemoteStrategyGroups(data: Strategy.GroupItem[], lastModified: string) {
    return this.Write(STRATEGY_GROUPS_FILE_PATH, data, lastModified);
  }

  async ReadRemoteStrategy(groupId: number, strategyId: number) {
    const strategyPath = `store/strategy_${groupId}_${strategyId}.json`;
    return this.Read(strategyPath);
  }

  async WriteRemoteStrategy(groupId: number, data: Strategy.ContentItem) {
    const strategyPath = `store/strategy_${groupId}_${data.id}.json`;
    return this.Write(strategyPath, data, data.modifiedTime);
  }
}

export default ThingsStorage;
