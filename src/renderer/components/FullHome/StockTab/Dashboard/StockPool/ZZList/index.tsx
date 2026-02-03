import React, { useCallback, useEffect, useLayoutEffect } from 'react';
import { Row, Col, InputNumber, Button } from 'antd';
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
import { Stock } from '@/types/stock';

const { ipcRenderer, makeWorkerExec } = window.contextModules.electron;

export interface CLListProps {
  onOpenStock: (secid: string, name: string) => void;
  active: boolean;
}

const CLList: React.FC<CLListProps> = ({ onOpenStock, active }) => {
  const stockConfigs = useSelector((state: StoreState) =>
    state.stock.stockConfigs.filter((c) => c.tags?.find((t) => t == '趋势' || t == '打板'))
  );
  const stocksMapping = useSelector((state: StoreState) => state.stock.stocksMapping);
  const [stocks, setStocks] = useState<Stock.CLItem[]>([]);
  const [refreshInterval, setRefreshInterval] = useState(30); // minutes
  const [running, setRunning] = useState(false);
  const { run: runMonitorStocks } = useRequest(() => makeWorkerExec('getAllStKlines', [stockConfigs.map(({ secid }) => secid), 250]), {
    throwOnError: true,
    manual: true,
    onSuccess: (data: Stock.KLineItem[][]) => {
      setRunning(false);
      const sts: Stock.CLItem[] = [];
      data.forEach((ks, i) => {
        if (ks && ks.length > 0) {
          Tech.DescribeKlines(ks);
          Tech.DetermineKlines(ks);
          const lastK = ks[ks.length - 1];
          if (stocksMapping[lastK.secid].detail) {
            const st = { ...stocksMapping[lastK.secid].detail } as unknown as Stock.CLItem;
            const config = stockConfigs.find((_) => _.secid == st.secid);
            st.hybk = config?.hybk;
            st.tag = config?.tags[0];
            st.latestK = lastK;
            sts.push(st);
          }
        }
      });
      setStocks(sts);
    },
  });
  const { run: mayMonitorStocks } = useThrottleFn(
    () => {
      setRunning(true);
      runMonitorStocks();
    },
    {
      wait: 2000,
    }
  );
  useWorkDayTimeToDo(
    () => {
      mayMonitorStocks();
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
    const extraMappings: Record<string, number> = {};
    let initVal = 1;
    arr.forEach((a) => {
      if (!extraMappings[a.bk]) {
        extraMappings[a.bk] = initVal++;
      }
      if (!extraMappings[a.tag]) {
        extraMappings[a.tag] = initVal++;
      }
    });
    arr.sort((a, b) => {
      let left = 0,
        right = 0;
      if (key == 'kshape') {
        left = a.latestK.describe.sshapeType;
        right = b.latestK.describe.sshapeType;
      } else if (key == 'bk') {
        left = extraMappings[a.bk];
        right = extraMappings[b.bk];
      } else if (key == 'tag') {
        left = extraMappings[a.tag];
        right = extraMappings[b.tag];
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

  useLayoutEffect(() => {
    if (showList.length > 0) {
      showList.forEach((item) => {
        const detail = stocksMapping[item.secid].detail;
        item.zx = detail.zx;
        item.zdf = detail.zdf;
        item.lt = detail.lt;
      });
      setShowList([...showList]);
    }
  }, [stocksMapping]);

  return (
    <>
      <div className={styles.header}>
        <span>刷新间隔&nbsp;</span>
        <InputNumber value={refreshInterval} size="small" onChange={setRefreshInterval} step={1} style={{ marginRight: 10 }} />
        <Button type="primary" size="small" loading={running} onClick={mayMonitorStocks}>
          主动执行
        </Button>
        <span>{progress}</span>
      </div>
      <Row className={styles.header}>
        <Col span={2}>名字</Col>
        <Col span={2}>
          板块
          <Button
            size="small"
            type="text"
            icon={sortTypes.bk == 1 ? <CaretUpOutlined /> : sortTypes.bk == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />}
            className={styles.sortbtn}
            onClick={() => updateSortType('bk')}
          />
        </Col>
        <Col span={2}>
          标签
          <Button
            size="small"
            type="text"
            icon={sortTypes.tag == 1 ? <CaretUpOutlined /> : sortTypes.tag == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />}
            className={styles.sortbtn}
            onClick={() => updateSortType('tag')}
          />
        </Col>
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
          KShape
          <Button
            size="small"
            type="text"
            icon={sortTypes.kshape == 1 ? <CaretUpOutlined /> : sortTypes.kshape == 2 ? <CaretDownOutlined /> : <CaretRightOutlined />}
            className={styles.sortbtn}
            onClick={() => updateSortType('kshape')}
          />
        </Col>
        <Col span={2}>DoBuy</Col>
        <Col span={2}>DoSell</Col>
      </Row>
      <div className={classNames(styles.table, styles.moreheader)}>
        {showList.map((s) => (
          <Row key={s.secid} className={styles.row}>
            <Col span={2} style={{ cursor: 'pointer' }} onClick={() => onOpenStock(s.secid, s.name)}>
              {s.name}
            </Col>
            <Col span={2}>{s.hybk?.name || s.bk}</Col>
            <Col span={2}>{s.tag}</Col>
            <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
              {s.zx.toFixed(2)}
            </Col>
            <Col span={2} className={Utils.GetValueColor(s.zdf).textClass}>
              {s.zdf.toFixed(2) + '%'}
            </Col>
            <Col span={2}>{(s.lt / 100000000).toFixed(2) + '亿'}</Col>
            <Col span={2}>{(s.hsl / 100).toFixed(2) + '%'}</Col>
            <Col span={2}>{SingleKLineShapeNames[s.latestK.describe?.sshapeType || 0]}</Col>
            <Col span={2}>{s.latestK.buyorsell?.doBuy ? 'Y' : ''}</Col>
            <Col span={2}>{s.latestK.buyorsell?.canSell ? 'Y' : ''}</Col>
          </Row>
        ))}
      </div>
    </>
  );
};

export default CLList;
