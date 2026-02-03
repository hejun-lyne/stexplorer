import React, { PropsWithChildren } from 'react';
import { Tabs } from 'antd';
import { useHomeContext } from '../MiniHome';

const GroupTab: React.FC<PropsWithChildren<Record<string, any>>> = (props) => {
  const { variableColors } = useHomeContext();

  const groupBarStyle = {
    background: variableColors['--background-color'],
    borderBottom: `1px solid ${variableColors['--border-color']}`,
    margin: 0,
    paddingLeft: 25,
  };

  return (
    <Tabs size="small" animated={{ tabPane: true, inkBar: true }} tabBarGutter={15} tabBarStyle={groupBarStyle}>
      {props.children}
    </Tabs>
  );
};
export default GroupTab;
