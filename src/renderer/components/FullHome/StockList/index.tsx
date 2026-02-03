import React from 'react';
import { Empty, Collapse } from 'antd';
import StockRow from '@/components/FullHome/StockList/StockRow';
import styles from './index.scss';
import { Stock } from '@/types/stock';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { StockMarketType } from '@/utils/enums';
import StockTagHeader from './StockTagHeader';

interface StockListProps {
  filterText: string;
  type: number;
  onStockDetail: (secid: string, name: string, change?: number, type?: StockMarketType) => void;
  onAddStockTag: (secid: string) => void;
  onTagViewAll: (name: string, markettype: StockMarketType) => void;
}

const StockList: React.FC<StockListProps> = React.memo(({ filterText, type, onStockDetail, onAddStockTag, onTagViewAll }) => {
  const configs = useSelector((state: StoreState) => state.stock.stockConfigs.filter((sc) => sc.type === type));
  const stocks = useSelector((state: StoreState) => state.stock.stocksMapping);
  const tags: string[] = [...new Set(([] as string[]).concat.apply([], [...configs.map((s) => s.tags || [])]))].filter((t) => t != '默认');
  const mappings: Record<string, Stock.SettingItem[]> = {};
  tags.forEach((t) => {
    let arr = configs.filter((c) => c.tags?.includes(t));
    if (filterText.length) {
      arr = arr.filter((s) => s.name != undefined ?s.name.includes(filterText) : false);
    }
    if (arr.length > 0) {
      mappings[t] = arr;
    }
  });
  const news = configs.filter((c) => !c.tags || (c.tags.length == 1 && c.tags[0] == '默认'));
  if (news.length) {
    tags.splice(0, 0, '未分类');
    mappings['未分类'] = news;
  }

  const maxzdf = {} as Record<string, number>;
  tags.forEach((t) => {
    const arr = mappings[t];
    if (arr) {
      maxzdf[t] = Math.max(...arr.map((_) => stocks[_.secid]?.detail.zdf || 0));
    }
  });
  const getV = (a: string) => {
    let av = a == '连板' ? 100 : a == '追涨' ? 99 : a == '抄底' ? 98 : -1;
    if (av == -1) {
      av = Number(a) ? -99 : maxzdf[a];
    }
    return av;
  };

  tags.sort((a, b) => {
    const av = getV(a);
    const bv = getV(b);
    return bv - av;
  });

  // 进行排序
  tags.forEach((t) => {
    const arr = mappings[t];
    arr?.sort((a, b) => {
      const da = stocks[a.secid]?.detail.zdf || 0;
      const db = stocks[b.secid]?.detail.zdf || 0;
      return db - da;
    });
  });

  return (
    <div className={styles.container}>
      {tags.length > 0 && (
        <>
          <Collapse bordered={false}>
            {tags.map((t, i) =>
              !mappings[t] ? (
                ''
              ) : (
                <Collapse.Panel
                  header={
                    <StockTagHeader name={t} mtype={type} zdf={maxzdf[t]} onTagViewAll={onTagViewAll} />
                  }
                  key={t}
                >
                  {mappings[t].map((s) => (
                    <StockRow
                      key={s.secid}
                      config={s}
                      tags={tags}
                      onClick={(c) => onStockDetail(c.secid, c.name, undefined, c.type)}
                      onAddTag={onAddStockTag}
                    />
                  ))}
                </Collapse.Panel>
              )
            )}
          </Collapse>
        </>
      )}
    </div>
  );
});
export default StockList;
