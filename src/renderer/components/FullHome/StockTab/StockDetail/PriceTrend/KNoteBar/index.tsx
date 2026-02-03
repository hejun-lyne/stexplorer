import React from 'react';
import { Row, Col, DatePicker, Select, Tooltip } from 'antd';
import styles from './index.scss';
import * as Services from '@/services';
import * as CONST from '@/constants';
import * as Utils from '@/utils';
import { useState } from 'react';
import { Stock } from '@/types/stock';
import { useRequest, useThrottleFn } from 'ahooks';
import { useCallback } from 'react';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import moment from 'moment';
import { StoreState } from '@/reducers/types';
import { useSelector } from 'react-redux';
import { KNoteType, KNoteTypeColors } from '@/utils/enums';

export interface KNoteBarProps {
  secid: string;
  dates: string[];
  range: {
    start: number;
    end: number;
  };
}

const KNoteBar: React.FC<KNoteBarProps> = ({ secid, dates, range }) => {
  const startIndex = Math.round((dates.length * range.start) / 100) - 1;
  const endIndex = Math.round((dates.length * range.end) / 100) - 1;
  const knotes = useSelector((store: StoreState) =>
    (store.stock.stockConfigsMapping[secid]?.knotes || []).filter((n) => n.startDate <= dates[endIndex] || n.endDate >= dates[startIndex])
  );
  const wp = (100 / (endIndex - startIndex + 1) - 0.01).toFixed(2) + '%';
  const KDate = (d: string) => {
    const mathNotes = knotes.filter((kn) => kn.startDate <= d && kn.endDate >= d);
    if (mathNotes.length == 0) {
      return (
        <div
          key={d}
          style={{
            width: wp,
            background: KNoteTypeColors[KNoteType.None],
            display: 'block',
            flex: `0 0 ${wp}`,
            maxWidth: wp,
            height: '100%',
          }}
        ></div>
      );
    }
    const color = KNoteTypeColors[mathNotes[mathNotes.length - 1].type];
    let hint = '';
    mathNotes.forEach((kn) => (hint += kn.text));
    return (
      <Tooltip title={hint} key={d}>
        <div
          key={d}
          style={{
            width: wp,
            background: color,
            display: 'block',
            flex: `0 0 ${wp}`,
            maxWidth: wp,
            height: '100%',
            borderLeft: '1px solid var(--main-text-color)',
          }}
        ></div>
      </Tooltip>
    );
  };
  return <div className={styles.container}>{dates.slice(startIndex, endIndex + 1).map((d) => KDate(d))}</div>;
};

export default KNoteBar;
