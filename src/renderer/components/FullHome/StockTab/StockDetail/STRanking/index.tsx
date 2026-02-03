import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as Services from '@/services';
import PureCard from '@/components/Card/PureCard';
import styles from './index.scss';
import classnames from 'classnames';
import * as Utils from '@/utils';
import * as CONST from '@/constants';
import * as Helpers from '@/helpers';
import { useRequest } from 'ahooks';
import { Stock } from '@/types/stock';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import { Button, Checkbox, Table } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { KFilterType, KFilterTypeNames } from '@/utils/enums';
import { batch } from 'react-redux';

export interface STRankingProps {
  details: Stock.DetailItem[];
  active: boolean;
  openStock: (secid: string, name: string, change?: number) => void;
}

const STRanking: React.FC<STRankingProps> = React.memo(({ details, active, openStock }) => {
  const [running, setRunning] = useState(false);
  const [stStatistics, setSTStatistics] = useState<Stock.KLineStatisticItem[]>([]);
  const { run: runStatisticSts } = useRequest(Helpers.Stock.StatisticMultiKlines, {
    throwOnError: true,
    manual: true,
    onSuccess: (data: any[]) => {
      batch(() => {
        setRunning(false);
        setSTStatistics(data.filter(Utils.NotEmpty));
      });
    },
  });

  const doAnalyze = useCallback(() => {
    runStatisticSts(details.map((_) => _.secid));
    setRunning(true);
  }, details);

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 80,
      fixed: 'left',
      render: (d, r) => <a onClick={() => openStock(r.secid, d, r.zdf)}>{d}</a>,
    },
    {
      title: '涨跌',
      dataIndex: 'zdf',
      sorter: (a, b) => a.zdf - b.zdf,
      defaultSortOrder: 'ascend',
      width: 60,
      fixed: 'left',
      render: (d) => <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>,
    },
    // {
    //   title: '价格',
    //   dataIndex: 'zx',
    //   sorter: (a, b) => a.zx - b.zx,
    //   defaultSortOrder: 'ascend',
    //   width: 80,
    //   render: (d) => d.toFixed(2),
    // },
    {
      title: '市值',
      dataIndex: 'lt',
      sorter: (a, b) => a.lt - b.lt,
      render: (d) => (d > 100000000 ? `${(d / 100000000).toFixed(2)}亿` : `${(d / 10000000).toFixed(2)}千万`),
      width: 60,
      defaultSortOrder: 'ascend',
    },
    {
      title: '上涨',
      dataIndex: 'zdays_5d',
      sorter: (a, b) => a.zdays_5d - b.zdays_5d,
      defaultSortOrder: 'descend',
      render: (d) => `${d} / 5`,
      width: 60,
    },
    {
      title: '上涨',
      dataIndex: 'zdays_10d',
      sorter: (a, b) => a.zdays_10d - b.zdays_10d,
      defaultSortOrder: 'descend',
      render: (d) => `${d} / 10`,
      width: 60,
    },
    {
      title: '涨停',
      dataIndex: 'zt_5d',
      sorter: (a, b) => a.zt_5d - b.zt_5d,
      defaultSortOrder: 'descend',
      render: (d) => `${d} / 5`,
      width: 60,
    },
    {
      title: '涨停',
      dataIndex: 'zt_10d',
      sorter: (a, b) => a.zt_10d - b.zt_10d,
      render: (d) => `${d} / 10`,
      defaultSortOrder: 'descend',
      width: 60,
    },
    {
      title: '-1H',
      dataIndex: 'b1d_hsl',
      sorter: (a, b) => a.b1d_hsl - b.b1d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => (!d ? '--' : `${d.toFixed(2)}%`),
    },
    {
      title: '-3H',
      dataIndex: 'b3d_hsl',
      sorter: (a, b) => a.b3d_hsl - b.b3d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => (!d ? '--' : `${d.toFixed(2)}%`),
    },
    {
      title: '-5H',
      dataIndex: 'b5d_hsl',
      sorter: (a, b) => a.b5d_hsl - b.b5d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => (!d ? '--' : `${d.toFixed(2)}%`),
    },
    {
      title: '-10H',
      dataIndex: 'b10d_hsl',
      sorter: (a, b) => a.b10d_hsl - b.b10d_hsl,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => (!d ? '--' : `${d.toFixed(2)}%`),
    },
    {
      title: '-1D',
      dataIndex: 'b1d_zdf',
      sorter: (a, b) => a.b1d_zdf - b.b1d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => (!d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>),
    },
    {
      title: '-3D',
      dataIndex: 'b3d_zdf',
      sorter: (a, b) => a.b3d_zdf - b.b3d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => (!d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>),
    },
    {
      title: '-5D',
      dataIndex: 'b5d_zdf',
      sorter: (a, b) => a.b5d_zdf - b.b5d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => (!d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>),
    },
    {
      title: '-10D',
      dataIndex: 'b10d_zdf',
      sorter: (a, b) => a.b10d_zdf - b.b10d_zdf,
      defaultSortOrder: 'descend',
      width: 60,
      render: (d) => (!d ? '--' : <span className={Utils.GetValueColor(d).textClass}>{d.toFixed(2)}%</span>),
    },
    {
      title: '-1R',
      dataIndex: 'b1d_rank',
      sorter: (a, b) => a.b1d_rank - b.b1d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-3R',
      dataIndex: 'b3d_rank',
      sorter: (a, b) => a.b3d_rank - b.b3d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-5R',
      dataIndex: 'b5d_rank',
      sorter: (a, b) => a.b5d_rank - b.b5d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: '-10R',
      dataIndex: 'b10d_rank',
      sorter: (a, b) => a.b10d_rank - b.b10d_rank,
      defaultSortOrder: 'ascend',
      width: 60,
    },
    {
      title: 'LHB',
      dataIndex: 'lhb_date',
      sorter: (a, b) => (a.lhb_date > b.lhb_date ? 1 : -1),
      defaultSortOrder: 'descend',
      width: 100,
    },
  ];
  useEffect(() => {
    if (details?.length && !stStatistics?.length) {
      doAnalyze();
    }
  }, [details]);
  const data = stStatistics.map((b) => {
    const d = details.find((a) => a.secid == b.secid);
    const md = { ...d, ...b };
    md.key = b.secid;
    return md;
  });
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={contentRef} className={classnames(styles.content, 'scroll-enabled')}>
      <div>
        <Button type="link" onClick={doAnalyze}>
          {running ? '处理中...' : '开始分析'}
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={data}
        pagination={{ defaultPageSize: 60, pageSizeOptions: [20, 60, 100] }}
        scroll={{ x: 600, y: contentRef.current ? contentRef.current.offsetHeight - 250 : 300 }}
      />
    </div>
  );
});
export default STRanking;
