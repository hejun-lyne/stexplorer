import React, { useCallback, useEffect, useLayoutEffect } from 'react';
import { Row, Col, InputNumber, Button } from 'antd';
import styles from '../index.scss';
import * as Utils from '@/utils';
import { useState } from 'react';
import { Stock } from '@/types/stock';
import { useRequest, useThrottleFn } from 'ahooks';
import { useWorkDayTimeToDo } from '@/utils/hooks';
import classNames from 'classnames';
import { SingleKLineShapeNames } from '@/utils/enums';
import { CaretDownOutlined, CaretRightOutlined, CaretUpOutlined } from '@ant-design/icons';

const { ipcRenderer, makeWorkerExec } = window.contextModules.electron;

export interface CLListProps {
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

const CLList: React.FC<CLListProps> = ({ onOpenStock, active }) => {
  const [financeThreshold, setFinanceThreshold] = useState(5);
  const [refreshInterval, setRefreshInterval] = useState(30); // minutes
  const [stocks, setStocks] = useState<Stock.CLItem[]>([]);
  const [running, setRunning] = useState(false);
  const { run: runGetStocks } = useRequest(() => makeWorkerExec('getFilteredStocks', [financeThreshold]), {
    throwOnError: true,
    manual: true,
    onSuccess: (data) => {
      setRunning(false);
      setStocks(data);
    },
  });
  const { run: mayGetStocks } = useThrottleFn(
    () => {
      setRunning(true);
      runGetStocks();
    },
    {
      wait: 2000,
    }
  );
  useWorkDayTimeToDo(
    () => {
      mayGetStocks();
    },
    active ? refreshInterval * 60 * 1000 : null
  );

  const [progress, setProgress] = useState('');
  useLayoutEffect(() => {
    ipcRenderer.on('on-progress-log', (e, data) => {
      console.log(data);
      setProgress(data);
    });
  }, []);
  const [showList, setShowList] = useState<Stock.CLItem[]>([]);
  const [sortTypes, setSortTypes] = useState<Record<string, number>>({});
  const sortStocks = useCallback((sts, key: string, t: number) => {
    if (t == 0) {
      return sts;
    }
    const arr = [...sts];
    arr.sort((a, b) => {
      let left = 0,
        right = 0;
      if (key.startsWith('finance_')) {
        const rkey = key.substring(8);
        left = a.finance[rkey];
        right = b.finance[rkey];
      } else if (key == 'kshape') {
        left = a.latestK.describe.sshapeType;
        right = b.latestK.describe.sshapeType;
      } else {
        left = a[key];
        right = b[key];
      }
      if (t == 1) {
        return left - right;
      } else {
        return right - left;
      }
    });
    setShowList(arr);
  }, []);
  const updateSortType = useCallback(
    (key) => {
      let type = sortTypes[key] || 0;
      type = type == 0 ? 1 : type == 1 ? 2 : 0;
      setSortTypes({ [key]: type });
    },
    [sortTypes]
  );

  useLayoutEffect(() => {
    const keys = Object.keys(sortTypes);
    if (keys.length == 1) {
      const key = keys[0];
      sortStocks(stocks, key, sortTypes[key]);
    } else {
      setShowList(stocks);
    }
  }, [stocks, sortTypes]);
  return (
    <>
      <div className={styles.header}>
        <span>刷新间隔&nbsp;</span>
        <InputNumber value={refreshInterval} size="small" onChange={setRefreshInterval} step={1} style={{ marginRight: 10 }} />
        <Button type="primary" size="small" loading={running} onClick={mayGetStocks}>
          主动执行
        </Button>
        <span>{progress}</span>
      </div>
      <Row className={styles.header}>
        <Col span={2}>名字</Col>
        <Col span={2}>板块</Col>
        <Col span={2}>
          最新价
          <Button
            size="small"
            type="text"
            icon={sortTypes.zx == 1 ? <CaretUpOutlined /> : sortTypes.zx == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />}
            className={styles.sortbtn}
            onClick={() => updateSortType('zx')}
          />
        </Col>
        <Col span={2}>
          涨跌幅
          <Button
            size="small"
            type="text"
            icon={sortTypes.zdf == 1 ? <CaretUpOutlined /> : sortTypes.zdf == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />}
            className={styles.sortbtn}
            onClick={() => updateSortType('zdf')}
          />
        </Col>
        <Col span={2}>
          流通市值
          <Button
            size="small"
            type="text"
            icon={sortTypes.lt == 1 ? <CaretUpOutlined /> : sortTypes.lt == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />}
            className={styles.sortbtn}
            onClick={() => updateSortType('lt')}
          />
        </Col>
        <Col span={2}>
          换手率
          <Button
            size="small"
            type="text"
            icon={sortTypes.hsl == 1 ? <CaretUpOutlined /> : sortTypes.hsl == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />}
            className={styles.sortbtn}
            onClick={() => updateSortType('hsl')}
          />
        </Col>
        <Col span={2}>
          营收同比
          <Button
            size="small"
            type="text"
            icon={
              sortTypes.finance_TOTALOPERATEREVETZ == 1 ? (
                <CaretUpOutlined />
              ) : sortTypes.finance_TOTALOPERATEREVETZ == 2 ? (
                <CaretDownOutlined />
              ) : (
                <CaretRightOutlined />
              )
            }
            className={styles.sortbtn}
            onClick={() => updateSortType('finance_TOTALOPERATEREVETZ')}
          />
        </Col>
        <Col span={3}>
          扣非利润同比
          <Button
            size="small"
            type="text"
            icon={
              sortTypes.finance_KCFJCXSYJLRTZ == 1 ? (
                <CaretUpOutlined />
              ) : sortTypes.finance_KCFJCXSYJLRTZ == 2 ? (
                <CaretDownOutlined />
              ) : (
                <CaretRightOutlined />
              )
            }
            className={styles.sortbtn}
            onClick={() => updateSortType('finance_KCFJCXSYJLRTZ')}
          />
        </Col>
        <Col span={2}>
          营收环比
          <Button
            size="small"
            type="text"
            icon={
              sortTypes.finance_YYZSRGDHBZC == 1 ? (
                <CaretUpOutlined />
              ) : sortTypes.finance_YYZSRGDHBZC == 2 ? (
                <CaretDownOutlined />
              ) : (
                <CaretRightOutlined />
              )
            }
            className={styles.sortbtn}
            onClick={() => updateSortType('finance_YYZSRGDHBZC')}
          />
        </Col>
        <Col span={3}>
          扣非利润环比
          <Button
            size="small"
            type="text"
            icon={
              sortTypes.finance_KFJLRGDHBZC == 1 ? (
                <CaretUpOutlined />
              ) : sortTypes.finance_KFJLRGDHBZC == 2 ? (
                <CaretDownOutlined />
              ) : (
                <CaretRightOutlined />
              )
            }
            className={styles.sortbtn}
            onClick={() => updateSortType('finance_KFJLRGDHBZC')}
          />
        </Col>
        <Col span={2}>
          KShape
          <Button
            size="small"
            type="text"
            icon={sortTypes.kshape == 1 ? <CaretUpOutlined /> : sortTypes.kshape == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />}
            className={styles.sortbtn}
            onClick={() => updateSortType('kshape')}
          />
        </Col>
      </Row>
      <div className={classNames(styles.table, styles.moreheader)}>
        {showList.map((s) => (
          <Row key={s.secid} className={styles.row}>
            <Col span={2} style={{ cursor: 'pointer' }} onClick={() => onOpenStock(s.secid, s.name)}>
              {s.name}
            </Col>
            <Col span={2}>{s.hybk?.name}</Col>
            <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
              {s.zx.toFixed(2)}
            </Col>
            <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
              {s.zdf.toFixed(2) + '%'}
            </Col>
            <Col span={2}>{(s.lt / 100000000).toFixed(2) + '亿'}</Col>
            <Col span={2}>{(s.hsl / 100).toFixed(2) + '%'}</Col>
            <Col span={2}>{!s.finance.TOTALOPERATEREVETZ ? '--' : s.finance.TOTALOPERATEREVETZ.toFixed(2) + '%'}</Col>
            <Col span={3}>{!s.finance.KCFJCXSYJLRTZ ? '--' : s.finance.KCFJCXSYJLRTZ.toFixed(2) + '%'}</Col>
            <Col span={2}>{!s.finance.YYZSRGDHBZC ? '--' : s.finance.YYZSRGDHBZC.toFixed(2) + '%'}</Col>
            <Col span={3}>{!s.finance.KFJLRGDHBZC ? '--' : s.finance.KFJLRGDHBZC.toFixed(2) + '%'}</Col>
            <Col span={2}>{SingleKLineShapeNames[s.latestK.describe?.sshapeType || 0]}</Col>
          </Row>
        ))}
      </div>
    </>
  );
};

export default CLList;
