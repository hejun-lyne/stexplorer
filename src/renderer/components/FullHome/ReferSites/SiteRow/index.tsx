import { addSiteTagAction, deleteFavorSiteAction, deleteSiteTagAction } from '@/actions/site';
import { CheckOutlined } from '@ant-design/icons';
import { Dropdown, Menu, Tooltip } from 'antd';
import React, { useCallback } from 'react';
import { useDispatch } from 'react-redux';
import styles from '../index.scss';
import Url from 'url-parse';

export interface SiteRowProps {
  site: Site.FavorItem;
  tags: string[];
  onAddSiteTag: (id: string) => void;
  onOpenSite: (site: Site.FavorItem) => void;
}

const SiteRow: React.FC<SiteRowProps> = React.memo(({ site, tags, onAddSiteTag, onOpenSite }) => {
  const dispatch = useDispatch();
  const menu = useCallback(() => {
    const onContextMenu = (e) => {
      switch (e.key) {
        case 'delete':
          dispatch(deleteFavorSiteAction(site.url));
          break;
        case 'new_tag':
          onAddSiteTag(site.id);
          break;
        default:
          if (site.tags?.includes(e.key)) {
            dispatch(deleteSiteTagAction(e.key, site.id));
          } else {
            dispatch(addSiteTagAction(e.key, site.id));
          }
          break;
      }
    };
    return (
      <Menu onClick={onContextMenu}>
        <Menu.Item key="delete" danger={true}>
          删除
        </Menu.Item>
        <Menu.Divider />
        <Menu.SubMenu title="选择分组">
          <Menu.Item key="new_tag">创建新分组</Menu.Item>
          {tags
            .filter((_) => _ !== '未分类')
            .map((t) => (
              <Menu.Item key={t}>
                {t}
                {site.tags?.includes(t) && <CheckOutlined />}
              </Menu.Item>
            ))}
        </Menu.SubMenu>
      </Menu>
    );
  }, [site]);

  return (
    <Dropdown overlay={() => menu()} trigger={['contextMenu']} key={site.id}>
      <div className={styles.row} onClick={() => onOpenSite(site)}>
        {/** 名字 */}
        <div className={styles.name}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 4px',
              marginRight: 5,
              backgroundColor: 'rgba(255, 255, 255, 0.25)',
              borderRadius: 2,
            }}
          >
            <img src={'http://www.google.com/s2/favicons?domain=' + new Url(site.url).host} width={16} height={16} />
          </span>
          {site.name.length > 12 ? (
            <Tooltip title={`${site.name} ${site.description ? site.description : ''}`}>
              <span>{site.name.substr(0, 9) + '...'}</span>
            </Tooltip>
          ) : (
            <Tooltip title={site.description}>
              <span>{site.name}</span>
            </Tooltip>
          )}
        </div>
        {/** 描述 */}
        <div className={styles.description}>
          <span>{site.description}</span>
        </div>
      </div>
    </Dropdown>
  );
});

export default SiteRow;
