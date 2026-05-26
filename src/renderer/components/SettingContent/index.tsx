import React, { useCallback, useState, useEffect } from 'react';
import classnames from 'classnames';
import { useSelector, useDispatch } from 'react-redux';
import { InputNumber, Radio, Badge, Switch, Slider, TimePicker, Input, Button, DatePicker, Alert, message } from 'antd';
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
import { saveBaiduTokensAction, clearBaiduTokensAction, loadBaiduTokensAction } from '@/actions/baidu';
import StorageSwitch from '../FullHome/Github/StorageSwitch';

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
    kimiApiKeySetting,
    initialCapital,
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
  const [kimiApiKey, setKimiApiKey] = useState(kimiApiKeySetting);

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
        kimiApiKeySetting: kimiApiKey,
        initialCapital,
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

  // 百度网盘 Access Token
  const { accessToken } = useSelector((state: StoreState) => state.baidu);
  const [bdTokenInput, setBdTokenInput] = useState('');
  
  // 加载时读取本地缓存的 token
  useEffect(() => {
    dispatch(loadBaiduTokensAction());
  }, [dispatch]);
  
  // 保存 Access Token
  const handleSaveBaiduToken = useCallback(() => {
    if (!bdTokenInput.trim()) {
      message.warning('请输入 Access Token');
      return;
    }
    dispatch(saveBaiduTokensAction(bdTokenInput.trim()));
    message.success('Access Token 已保存');
    setBdTokenInput('');
  }, [bdTokenInput, dispatch]);
  
  // 清除 Access Token
  const handleClearBaiduToken = useCallback(() => {
    dispatch(clearBaiduTokensAction());
    message.success('Access Token 已清除');
  }, [dispatch]);
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
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>Access Token：</label>
              {accessToken ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#52c41a' }}>✓ 已配置</span>
                  <Button size="small" onClick={handleClearBaiduToken} danger>
                    清除
                  </Button>
                </div>
              ) : (
                <span style={{ color: '#999' }}>未配置</span>
              )}
            </section>
            <section>
              <Input.Password
                placeholder="输入百度网盘 Access Token"
                value={bdTokenInput}
                onChange={(e) => setBdTokenInput(e.target.value)}
                style={{ flex: 1 }}
              />
              <Button type="primary" onClick={handleSaveBaiduToken} disabled={!bdTokenInput.trim()}>
                保存
              </Button>
            </section>
            <Alert
              message="如何获取 Access Token"
              description={
                <ol style={{ paddingLeft: 16, margin: 0 }}>
                  <li>访问百度网盘开放平台：<a onClick={() => onOpenUrl('https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&client_id=XRUlsAlaWm5XUd4QehFDQihKwhqhOdLq&redirect_uri=oob&scope=netdisk')}>点击获取 Token</a></li>
                  <li>登录百度账号并授权应用</li>
                  <li>授权成功后，从浏览器地址栏复制 access_token 参数值</li>
                  <li>将复制的 Token 粘贴到上方输入框并保存</li>
                </ol>
              }
              type="info"
              showIcon
              style={{ marginTop: 8 }}
            />
          </div>
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
                  { label: 'Akshare', value: Enums.FundApiType.Akshare },
                  { label: 'Tushare', value: Enums.FundApiType.Tushare },
                ]}
                onChange={(e) => setKLineApiSource(e.target.value)}
                value={kLineApiSource}
              />
            </section>
          </div>
        </StandCard>
        <StandCard icon={<SettingIcon />} title="AI 分析">
          <div className={classnames(styles.setting, 'card-body')}>
            <section>
              <label>Kimi API Key：</label>
              <Input.Password
                value={kimiApiKey}
                onChange={(e) => setKimiApiKey(e.target.value)}
                placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                size="small"
                style={{ flex: 1 }}
              />
            </section>
            <section>
              <label></label>
              <span style={{ fontSize: 12, color: '#999' }}>
                在 <a onClick={() => onOpenUrl('https://platform.moonshot.cn/console/account')}>Kimi 开放平台</a> 获取 API Key
              </span>
            </section>
          </div>
        </StandCard>
        <StorageSwitch />
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
