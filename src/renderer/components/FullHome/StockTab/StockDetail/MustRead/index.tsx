import React from 'react';
import styles from './index.scss';
import { useHomeContext } from '@/components/FullHome';

export interface MustReadProps {
  code: string;
}

const MustRead: React.FC<MustReadProps> = React.memo(({ code }) => {
  const { darkMode } = useHomeContext();
  const url = `https://emh5.eastmoney.com/html/index.html?fc=${code}0${code.startsWith('3') ? 2 : 1}&color=${darkMode ? 'g' : 'w'}#/cpbd`;
  return (
    <div className={styles.container}>
      <iframe src={url}></iframe>
    </div>
  );
});
export default MustRead;
