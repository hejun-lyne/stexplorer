import React from 'react';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import { StockMarketType } from '@/utils/enums';
import STMonitor from '../Dashboard/StockPool/STMonitor';

export interface TagContentViewProps {
  name: string;
  type: StockMarketType;
  openStock: (secid: string, name: string, change?: number) => void;
}

const TagContentView: React.FC<TagContentViewProps> = React.memo(({ name, type, openStock }) => {
    const configs = useSelector((storeState: StoreState) => storeState.stock.stockConfigs.filter((c) => c.tags?.includes(name)));
    const stocksMapping = useSelector((storeState: StoreState) => storeState.stock.stocksMapping);
    return (
        <STMonitor
            details={configs.map((config) => stocksMapping[config.secid].detail)}
            active={true}
            noMore={true}
            onLoadMore={() => { }}
            onOpenStock={openStock}
            stopStock={() => { }}
        />
    );
});
export default TagContentView;
