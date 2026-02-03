import React, { useCallback, useState } from 'react';
import classnames from 'classnames';
import { useSelector, useDispatch } from 'react-redux';
import { InputNumber, Radio, Badge, Switch, Slider, TimePicker, Input, Button, DatePicker } from 'antd';
import moment from 'moment';
import dayjs from 'dayjs';

import StandCard from '../Card/StandCard';
import CustomDrawerContent from '../CustomDrawer/Content';
import { ReactComponent as SettingIcon } from '@/assets/icons/setting.svg';
import { ReactComponent as DataSourceIcon } from '@/assets/icons/link.svg';
import { ReactComponent as ThemeIcon } from '@/assets/icons/t-shirt.svg';
import { ReactComponent as HintIcon } from '@/assets/icons/notification.svg';
import { defaultSystemSetting } from '@/helpers/setting';
import { setSystemSettingAction } from '@/actions/setting';
import { StoreState } from '@/reducers/types';
import * as Enums from '@/utils/enums';
import styles from './index.scss';
import * as Services from '@/services';
import { saveBaiduTokensAction } from '@/actions/baidu';

export interface SettingContentProps {
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}

const { shell, app, clipboard, dialog } = window.contextModules.electron;
const { electron, version } = window.contextModules.process;

const SettingContent: React.FC<SettingContentProps> = ({ onClose, onOpenUrl }) => {
  const dispatch = useDispatch();
  const {
    fundApiTypeSetting,
    conciseSetting,
    lowKeySetting,
    baseFontSizeSetting,
    systemThemeSetting,
    adjustmentNotificationSetting,
    adjustmentNotificationTimeSetting,
    trayContentSetting,
    autoStartSetting,
    autoFreshSetting,
    freshDelaySetting,
    ontrain,
    trainDate,
    kLineApiSourceSetting,
  } = useSelector((state: StoreState) => state.setting.systemSetting);
  // 数据来源
  const [fundApiType, setFundApiType] = useState(fundApiTypeSetting);
  // 训练模式
  const [istrain, setIstrain] = useState(ontrain);
  const [ontrainDate, setontrainDate] = useState(trainDate);
  // 外观设置
  const [concise, setConcise] = useState(conciseSetting);
  const [lowKey, setLowKey] = useState(lowKeySetting);
  const [baseFontSize, setBaseFontSize] = useState(baseFontSizeSetting);
  const [systemTheme, setSystemTheme] = useState(systemThemeSetting);
  // 通知设置
  const [adjustmentNotification, setAdjustmentNotification] = useState(adjustmentNotificationSetting);
  const [adjustmentNotificationTime, setAdjustmentNotifitationTime] = useState(adjustmentNotificationTimeSetting);
  const [trayContent, setTrayContent] = useState(trayContentSetting);
  // 通用设置
  const [autoStart, setAutoStart] = useState(autoStartSetting);
  const [autoFresh, setAutoFresh] = useState(autoFreshSetting);
  const [freshDelay, setFreshDelay] = useState(freshDelaySetting);
  const [kLineApiSource, setKLineApiSource] = useState(kLineApiSourceSetting);

  function onSave() {
    dispatch(
      setSystemSettingAction({
        fundApiTypeSetting: fundApiType,
        conciseSetting: concise,
        lowKeySetting: lowKey,
        baseFontSizeSetting: baseFontSize,
        systemThemeSetting: systemTheme,
        adjustmentNotificationSetting: adjustmentNotification,
        adjustmentNotificationTimeSetting: adjustmentNotificationTime || defaultSystemSetting.adjustmentNotificationTimeSetting,
        trayContentSetting: trayContent,
        autoStartSetting: autoStart,
        autoFreshSetting: autoFresh,
        freshDelaySetting: freshDelay || defaultSystemSetting.freshDelaySetting,
        ontrain: istrain,
        trainDate: ontrainDate,
        kLineApiSourceSetting: kLineApiSource,
      })
    );
  }

  function onCopyGroup(number: string) {
    clipboard.writeText(number);
    dialog.showMessageBox({
      title: '复制成功',
      type: 'info',
      message: `已复制到粘贴板`,
    });
  }

  const { clientId, clientSecret, redirectUri, accessToken } = useSelector((state: StoreState) => state.baidu);
  const openBaiduLogin = useCallback(() => {
    onOpenUrl(`https://openapi.baidu.com/oauth/2.0/authorize?response_type=code&client_id=${clientId}&redirect_uri=oob&scope=netdisk`);
  }, [clientId]);
  const [bdCode, setBdCode] = useState('');
  const [bdText, setBdText] = useState(accessToken ? '验证通过' : '开始校验');
  function confirmBaiduCode() {
    setBdText('开始校验');
    if (bdCode.length == 0) {
      return;
    }
    Services.Baidu.requestOAuthTokens(bdCode, clientId, clientSecret, redirectUri).then((res) => {
      if (!res) {
        setBdText('验证失败');
      } else {
        setBdText('验证通过');
        dispatch(saveBaiduTokensAction(res));
      }
      return res;
    });
  }
  const onChangeTrainDate = useCallback((d: moment.Moment | null) => {
    if (d) {
      const nd = d.format('YYYY-MM-DD');
      setontrainDate(nd);
    }
  }, []);
  return (
    <CustomDrawerContent title="设置" enterText="保存" onClose={onClose} onEnter={onSave}>
      <style>{` html { font-size: ${baseFontSize}px }`}</style>
      <div className={styles.content}>
        <StandCard icon={<DataSourceIcon />} title="百度云盘">
          <a onClick={openBaiduLogin}>登录并获取授权码</a>
          <Input placeholder="输入授权码" onChange={(e) => setBdCode(e.target.value)} />
          <Button onClick={confirmBaiduCode}>{bdText}</Button>
        </StandCard>
        <StandCard icon={<DataSourceIcon />} title="训练模式">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>训练开关：</label>
              <Switch size="small" checked={istrain} onChange={setIstrain} />
            </section>
            <section>
              <label>训练日期：</label>
              <DatePicker onChange={onChangeTrainDate} value={moment(ontrainDate)} style={{ marginRight: 10 }} />
            </section>
          </div>
        </StandCard>
        <StandCard icon={<ThemeIcon />} title="外观设置">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>简洁模式：</label>
              <Switch size="small" checked={concise} onChange={setConcise} />
            </section>
            <section>
              <label>低调模式：</label>
              <Switch size="small" checked={lowKey} onChange={setLowKey} />
            </section>
            <section>
              <label>字体大小：</label>
              <Slider min={11} max={14} style={{ flex: 0.5 }} defaultValue={baseFontSize} onChange={setBaseFontSize} step={0.1} />
            </section>
            <section>
              <label>系统主题：</label>
              <Radio.Group
                optionType="button"
                size="small"
                buttonStyle="solid"
                options={[
                  { label: '亮', value: Enums.SystemThemeType.Light },
                  { label: '暗', value: Enums.SystemThemeType.Dark },
                  { label: '自动', value: Enums.SystemThemeType.Auto },
                ]}
                onChange={(e) => setSystemTheme(e.target.value)}
                value={systemTheme}
              />
            </section>
          </div>
        </StandCard>
        <StandCard icon={<HintIcon />} title="通知设置">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>调仓提醒：</label>
              <Switch size="small" checked={adjustmentNotification} onChange={setAdjustmentNotification} />
            </section>
            <section>
              <label>提醒时间：</label>
              <TimePicker
                disabled={!adjustmentNotification}
                allowClear={false}
                size="small"
                value={moment(dayjs(adjustmentNotificationTime).format('HH:mm:ss'))}
                onChange={(v) => setAdjustmentNotifitationTime(v!.format('HH:mm:ss'))}
                format="HH:mm"
              />
            </section>
            <section>
              <label>托盘内容：</label>
              <Radio.Group
                optionType="button"
                size="small"
                buttonStyle="solid"
                options={[
                  { label: '收益', value: Enums.TrayContent.Sy },
                  { label: '收益率', value: Enums.TrayContent.Syl },
                  { label: '无', value: Enums.TrayContent.None },
                ]}
                onChange={(e) => setTrayContent(e.target.value)}
                value={trayContent}
              />
            </section>
          </div>
        </StandCard>
        <StandCard icon={<SettingIcon />} title="系统设置">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>开机自启：</label>
              <Switch size="small" checked={autoStart} onChange={setAutoStart} />
            </section>
            <section>
              <label>自动刷新：</label>
              <Switch size="small" checked={autoFresh} onChange={setAutoFresh} />
            </section>
            <section>
              <label>刷新间隔：</label>
              <InputNumber
                disabled={!autoFresh}
                value={freshDelay}
                onChange={setFreshDelay}
                placeholder="1~60分钟"
                precision={0}
                min={1}
                max={60}
                size="small"
              />
            </section>
          </div>
        </StandCard>
        <StandCard icon={<SettingIcon />} title="数据来源">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>K线数据源：</label>
              <Radio.Group
                optionType="button"
                size="small"
                buttonStyle="solid"
                options={[
                  { label: '东财', value: Enums.FundApiType.Eastmoney },
                  { label: 'XTick', value: Enums.FundApiType.XTick },
                  { label: 'ZiZai', value: Enums.FundApiType.ZiZai },
                ]}
                onChange={(e) => setKLineApiSource(e.target.value)}
                value={kLineApiSource}
              />
            </section>
          </div>
        </StandCard>
      </div>
      <div className={styles.exit}>
        <button type="button" onClick={() => app.quit()}>
          退出程序
        </button>
      </div>
      <div className={styles.version}>
        <div>Based on Electron v{electron}</div>
      </div>
    </CustomDrawerContent>
  );
};

export default SettingContent;
