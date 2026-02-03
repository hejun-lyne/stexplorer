import React, { useState } from 'react';
import styles from './index.scss';
import { StoreState } from '@/reducers/types';
import { useSelector } from 'react-redux';
import { Collapse } from 'antd';
import SiteRow from './SiteRow';

interface ReferSitesProps {
  filterText: string;
  onOpenSite: (site: Site.FavorItem) => void;
  onAddSiteTag: (id: string) => void;
}

const ReferSites: React.FC<ReferSitesProps> = ({ filterText, onOpenSite, onAddSiteTag }) => {
  const sites = useSelector((state: StoreState) => state.site.stars);
  const tags: string[] = [...new Set([].concat.apply([], [...sites.map((s) => s.tags || [])]))].filter((t) => t != '默认');
  const mappings: Record<string, Site.FavorItem[]> = {};
  tags.forEach((t) => {
    mappings[t] = sites.filter((c) => c.tags?.includes(t));
  });
  const news = sites.filter((c) => !c.tags || (c.tags.length == 1 && c.tags[0] == '默认'));
  if (news.length) {
    tags.splice(0, 0, '未分类');
    mappings['未分类'] = news;
  }
  return (
    <div className={styles.container}>
      {tags.length > 0 && (
        <>
          <Collapse bordered={false}>
            {tags.map((t) => (
              <Collapse.Panel header={t} key={t}>
                {mappings[t]
                  .filter((s) => (filterText.length ? s.name.includes(filterText) : true))
                  .map((s) => (
                    <SiteRow key={s.id} site={s} tags={tags} onAddSiteTag={onAddSiteTag} onOpenSite={onOpenSite} />
                  ))}
              </Collapse.Panel>
            ))}
          </Collapse>
        </>
      )}
    </div>
  );
};

export default ReferSites;
