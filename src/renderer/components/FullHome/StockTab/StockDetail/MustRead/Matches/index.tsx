import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Row, Col, InputNumber, Button, DatePicker, Table } from 'antd';
import styles from '../index.scss';
import * as Utils from '@/utils';
import { useState } from 'react';
import { useRequest, useThrottleFn } from 'ahooks';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import classNames from 'classnames';
import { SingleKLineShapeNames } from '@/utils/enums';
import { CaretDownOutlined, CaretRightOutlined, CaretUpOutlined } from '@ant-design/icons';
import { useSelector } from 'react-redux';
import { StoreState } from '@/reducers/types';
import * as Tech from '@/helpers/tech';
import * as Strategy from '@/helpers/strategy';
import { Stock } from '@/types/stock';
import moment from 'moment';

export interface MatchListProps {
  secid: string;
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

const MatchList: React.FC<MatchListProps> = ({ secid, onOpenStock, active }) => {
  const [stocks, setStocks] = useState<Stock.MatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [progress, setProgress] = useState('');
  const { run: runStartMatching } = useRequest(() => Strategy.runMatching(secid, startDate, endDate, setProgress), {
    throwOnError: true,
    manual: true,
    onSuccess: setStocks,
  });
  const { run: mayStartMatching } = useThrottleFn(
    () => {
      setRunning(true);
      runStartMatching();
    },
    {
      wait: 2000,
    }
  );
  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 80,
      fixed: 'left',
      render: (d, r) => <a onClick={() => onOpenStock(r.secid, d)}>{d}</a>,
    },
    {
      title: '板块',
      dataIndex: 'bk',
      width: 80,
      fixed: 'left',
      render: (d, r) => <span>{d.hybk ? d.hybk.name : d.bk}</span>,
    },
    {
      title: '涨跌',
      dataIndex: 'zdf',
      width: 60,
      fixed: 'left',
      render: (d) => <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>,
    },
    {
      title: '价格',
      dataIndex: 'zx',
      width: 80,
      render: (d) => d.toFixed(2),
    },
    {
      title: '市值',
      dataIndex: 'lt',
      render: (d) => (d > 100000000 ? `${(d / 100000000).toFixed(2)}亿` : `${(d / 10000000).toFixed(2)}千万`),
      width: 60,
    },
    {
      title: '匹配度',
      dataIndex: 'matchdiff',
      sorter: (a, b) => a.match.diff - b.match.diff,
      render: (d) => d.match.diff.toFixed(4),
      width: 60,
      defaultSortOrder: 'ascend',
    },
    {
      title: '匹配日期',
      dataIndex: 'matchdate',
      sorter: (a, b) => a.match.date - b.match.date,
      render: (d) => d.match.date,
      width: 100,
      defaultSortOrder: 'descend',
    },
  ];
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div style={{ marginTop: 5, marginBottom: 5 }}>
        <span>日期&nbsp;</span>
        <DatePicker
          size='small'
          onChange={(d) => setStartDate(d?.format('YYYY-MM-DD') || '')}
          defaultValue={moment(new Date())}
          style={{ marginRight: 10 }}
        />
        <DatePicker
          size='small'
          onChange={(d) => setEndDate(d?.format('YYYY-MM-DD') || '')}
          defaultValue={moment(new Date())}
          style={{ marginRight: 10 }}
        />
        <Button type="primary" size="small" loading={running} onClick={mayStartMatching}>
          开始匹配
        </Button>
        <span>{progress}</span>
      </div>
      <div ref={contentRef} className={classNames(styles.table)}>
        <Table
          columns={columns}
          dataSource={stocks}
          pagination={{ defaultPageSize: 60, pageSizeOptions: [20, 60, 100] }}
          scroll={{ x: 600, y: contentRef.current ? contentRef.current.offsetHeight - 250 : 300 }}
        />
      </div>
    </>
  );
};

export default MatchList;
