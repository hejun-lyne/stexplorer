import React, { useEffect, useRef, useState } from 'react';
import styles from './index.scss';
import * as Helpers from '@/helpers';
import * as Utils from '@/utils';
import { useRequest } from 'ahooks';
import { Col, Collapse, Modal, Row, Table, Tabs } from 'antd';

export interface DeptTradeBackProps {
  codes: string[];
  visible: boolean;
  close: () => void;
}

const DeptTradeBack: React.FC<DeptTradeBackProps> = React.memo(({ codes, visible, close }) => {
  const [depts, setDepts] = useState<any[]>([]);
  const { run: runGetTradeBacks } = useRequest(Helpers.Stock.GetDeptTradeBacks, {
    throwOnError: true,
    manual: true,
    onSuccess: (data) => {
      setDepts(data);
    },
    cacheKey: `GetDeptTradeBacks/${codes}`,
  });
  useEffect(() => {
    if (!depts.length && codes.length) {
      runGetTradeBacks(codes);
    }
  }, [codes]);
  const columns = [
    {
      title: '营业部',
      dataIndex: 'OPERATEDEPT_NAME',
      width: 220,
      fixed: 'left',
    },
    {
      title: '1D_ZD',
      dataIndex: 'AVERAGE_INCREASE_1DAY',
      sorter: (a, b) => a.AVERAGE_INCREASE_1DAY - b.AVERAGE_INCREASE_1DAY,
      defaultSortOrder: 'ascend',
      width: 80,
      render: (d) => <span className={Utils.GetValueColor(d).textClass}>{!d ? '--' : d.toFixed(2)}%</span>,
    },
    {
      title: '1D_WR',
      dataIndex: 'RISE_PROBABILITY_1DAY',
      sorter: (a, b) => a.RISE_PROBABILITY_1DAY - b.RISE_PROBABILITY_1DAY,
      defaultSortOrder: 'ascend',
      width: 80,
      render: (d) => <span className={Utils.GetValueColor(d - 50).textClass}>{!d ? '--' : d.toFixed(2)}%</span>,
    },
    {
      title: '2D_ZD',
      dataIndex: 'AVERAGE_INCREASE_2DAY',
      sorter: (a, b) => a.AVERAGE_INCREASE_2DAY - b.AVERAGE_INCREASE_2DAY,
      defaultSortOrder: 'ascend',
      width: 80,
      render: (d) => <span className={Utils.GetValueColor(d).textClass}>{!d ? '--' : d.toFixed(2)}%</span>,
    },
    {
      title: '2D_WR',
      dataIndex: 'RISE_PROBABILITY_2DAY',
      sorter: (a, b) => a.RISE_PROBABILITY_2DAY - b.RISE_PROBABILITY_2DAY,
      defaultSortOrder: 'ascend',
      width: 80,
      render: (d) => <span className={Utils.GetValueColor(d - 50).textClass}>{!d ? '--' : d.toFixed(2)}%</span>,
    },
    {
      title: '3D_ZD',
      dataIndex: 'AVERAGE_INCREASE_1DAY',
      sorter: (a, b) => a.AVERAGE_INCREASE_3DAY - b.AVERAGE_INCREASE_3DAY,
      defaultSortOrder: 'ascend',
      width: 80,
      render: (d) => <span className={Utils.GetValueColor(d).textClass}>{!d ? '--' : d.toFixed(2)}%</span>,
    },
    {
      title: '3D_WR',
      dataIndex: 'RISE_PROBABILITY_3DAY',
      sorter: (a, b) => a.RISE_PROBABILITY_3DAY - b.RISE_PROBABILITY_3DAY,
      defaultSortOrder: 'ascend',
      width: 80,
      render: (d) => <span className={Utils.GetValueColor(d - 50).textClass}>{!d ? '--' : d.toFixed(2)}%</span>,
    },
    {
      title: '5D_ZD',
      dataIndex: 'AVERAGE_INCREASE_1DAY',
      sorter: (a, b) => a.AVERAGE_INCREASE_5DAY - b.AVERAGE_INCREASE_5DAY,
      defaultSortOrder: 'ascend',
      width: 80,
      render: (d) => <span className={Utils.GetValueColor(d).textClass}>{!d ? '--' : d.toFixed(2)}%</span>,
    },
    {
      title: '5D_WR',
      dataIndex: 'RISE_PROBABILITY_1DAY',
      sorter: (a, b) => a.RISE_PROBABILITY_5DAY - b.RISE_PROBABILITY_5DAY,
      defaultSortOrder: 'ascend',
      width: 80,
      render: (d) => <span className={Utils.GetValueColor(d - 50).textClass}>{!d ? '--' : d.toFixed(2)}%</span>,
    },
    {
      title: '10D_ZD',
      dataIndex: 'AVERAGE_INCREASE_1DAY',
      sorter: (a, b) => a.AVERAGE_INCREASE_10DAY - b.AVERAGE_INCREASE_10DAY,
      defaultSortOrder: 'ascend',
      width: 80,
      render: (d) => <span className={Utils.GetValueColor(d).textClass}>{!d ? '--' : d.toFixed(2)}%</span>,
    },
    {
      title: '10D_WR',
      dataIndex: 'RISE_PROBABILITY_10DAY',
      sorter: (a, b) => a.RISE_PROBABILITY_10DAY - b.RISE_PROBABILITY_10DAY,
      defaultSortOrder: 'ascend',
      width: 80,
      render: (d) => <span className={Utils.GetValueColor(d - 50).textClass}>{!d ? '--' : d.toFixed(2)}%</span>,
    },
  ];
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Modal title="买入机构回测" visible={visible} onOk={close} onCancel={close} closable={false} width={800}>
      <div ref={contentRef} className={styles.content}>
        <Table
          columns={columns}
          dataSource={depts.filter((d) => d.length > 0).map((d) => d[0])}
          pagination={{ defaultPageSize: 50, pageSizeOptions: [20, 50, 100] }}
          scroll={{ x: 600, y: contentRef.current ? contentRef.current.offsetHeight : 300 }}
        />
      </div>
    </Modal>
  );
});
export default DeptTradeBack;
