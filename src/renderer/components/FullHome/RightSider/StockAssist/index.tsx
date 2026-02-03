import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import CustomDrawerContent from '@/components/CustomDrawer/Content';
import { Button, Col, Form, Input, InputNumber, Row, Select } from 'antd';
import { addTagMonitor } from '@/actions/setting';
import { StoreState } from '@/reducers/types';
import { CStateStrings, GStateStrings, KLineType, KStateStrings, MAType } from '@/utils/enums';
import styles from './index.scss';
import moment from 'moment';
import { appendTrade } from '@/actions/stock';
import * as Utils from '@/utils';
import TradeHist from '../TradeHist';
import { Stock } from '@/types/stock';
import { number } from 'echarts';

export interface StockAssistProps {
  secid: string;
  onOpenStock: (secid: string, name: string) => void;
  onOpenReview: () => void;
}

const StockAssist: React.FC<StockAssistProps> = React.memo(({ secid, onOpenStock, onOpenReview }) => {
  return (
    <div className={styles.container}>
      <div>
        <div className={styles.hists}>
          <TradeHist onOpenStock={onOpenStock} onOpenReview={onOpenReview} />
        </div>
      </div>
    </div>
  );
});

export default StockAssist;
