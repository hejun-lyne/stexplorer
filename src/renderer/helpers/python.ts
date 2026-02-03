import * as Utils from '@/utils';
import * as CONST from '@/constants';

const { execPyScript } = window.contextModules.electron;
export function TestPythonShell() {
  execPyScript('hello.py', [])
    .then((res) => {
      console.log(res);
      return res;
    })
    .catch((err) => {
      console.log(err);
    });
}
