const { got, electron } = window.contextModules;

export async function requestOAuthTokens(code: string, key: string, secret: string, uri: string) {
  try {
    const url = `https://openapi.baidu.com/oauth/2.0/token?grant_type=authorization_code&code=${code}&client_id=${key}&client_secret=${secret}&redirect_uri=oob`;
    const {
      body: { error, access_token, refresh_token },
    } = await got<{
      error: '';
      access_token: '';
      refresh_token: '';
    }>(url, {
      responseType: 'json',
    });
    if (error) {
      console.error('获取baidu access_token 失败:' + error);
      return null;
    }
    return { code, accessToken: access_token, refreshToken: refresh_token };
  } catch (error) {
    console.log('获取baidu access_token 失败:', error);
    return null;
  }
}

export async function refreshOAuthTokens(refreshToken: string, key: string, secret: string) {
  try {
    const url = `https://openapi.baidu.com/oauth/2.0/token?grant_type=refresh_token&client_id=${key}&client_secret=${secret}&refresh_token=${refreshToken}`;
    const {
      body: { error, access_token, refresh_token },
    } = await got<{
      error: '';
      access_token: '';
      refresh_token: '';
    }>(url, {
      responseType: 'json',
    });
    if (error) {
      console.error('获取baidu access_token 失败:' + error);
      return null;
    }
    return { accessToken: access_token, refreshToken: refresh_token };
  } catch (error) {
    console.log('获取baidu access_token 失败:', error);
    return null;
  }
}

export async function uploadFile(accessToken: string, dir: string, fileName: string, contents: string) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const res = electron.uploadBaiduFile(contents, dir, fileName, accessToken);
      resolve(res);
    });
  });
}

export async function createDir(accessToken: string, dir: string) {
  async function uploadFileStep1(params: any) {
    console.log('createDir_uploadFileStep1: ' + JSON.stringify(params));
    const url = `http://pan.baidu.com/rest/2.0/xpan/file?method=precreate&access_token=${params.accessToken}`;
    const data = `path=${encodeURI(params.dir)}&size=0&isdir=1&autoinit=1&rtype=0&block_list=[]`;
    const { body } = await got(url, {
      method: 'POST',
      body: data,
    });
    const res1 = JSON.parse(body);
    return { ...params, res1 };
  }
  async function uploadFileStep3(params: any) {
    console.log('createDir_uploadFileStep3: ' + JSON.stringify(params));
    const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=${params.accessToken}`;
    const data = `path=${params.dir}&size=0&isdir=1&uploadid=${params.res1.uploadid}&block_list=[]`;
    const { body } = await got(url, {
      method: 'POST',
      body: data,
    });
    const res3 = JSON.parse(body);
    return { ...params, res3 };
  }
  try {
    let res = await uploadFileStep1({ accessToken, dir });
    console.log('step1: ' + JSON.stringify(res));
    if (res.res1) {
      if (res.res1.errno == 0) {
        res = await uploadFileStep3(res);
        console.log('step3: ' + JSON.stringify(res));
        if (res.res3) {
          return res.res3;
        } else {
          throw new Error('创建文件记录失败');
        }
      } else {
        return res.res1;
      }
    } else {
      throw new Error('创建预上传任务失败');
    }
  } catch (error) {
    console.log(error);
  }
}

export async function getFileList(accessToken: string, dir: string) {
  try {
    const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=list&dir=${encodeURI(dir)}&order=time&start=0&limit=1000&web=web&folder=0&access_token=${accessToken}&desc=1`;
    const {
      body: { errno, list },
    } = await got<{
      errno: 0;
      guid_info: '';
      list: [
        {
          server_filename: 'abc';
          privacy: 0;
          category: 6;
          unlist: 0;
          fs_id: 770693330924692;
          dir_empty: 1;
          server_atime: 0;
          server_ctime: 1596078019;
          local_mtime: 1596078019;
          size: 0;
          isdir: 1;
          share: 0;
          path: '/测试目录/abc';
          local_ctime: 1596078019;
          server_mtime: 1596078019;
          empty: 0;
          oper_id: 2082810368;
        }
      ];
      request_id: 4904657509137213829;
      guid: 0;
    }>(url, {
      responseType: 'json',
    });
    if (errno != 0) {
      console.error('获取baidu 目录文件列表失败:' + errno);
      return { errno };
    } else {
      return { errno, list };
    }
  } catch (error) {
    console.error('获取baidu 目录文件列表失败:' + error);
    return null;
  }
}

export async function getFileDLink(accessToken: string, fileId: number) {
  try {
    const url = `http://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&access_token=${accessToken}&fsids=%5B${fileId}%5D&thumb=1&dlink=1&extra=1`;
    const {
      body: { errno, list },
    } = await got<{
      errmsg: 'succ';
      errno: 0;
      list: [
        {
          category: 3;
          date_taken: 1364134922;
          dlink: 'https://d.pcs.baidu.com/file/1261d72d03471f7b7b805fd60e024b8d?fid=2082810368-250528-414244021542671&rt=pr&sign=FDtAERV-DCb740ccc5511e5e8fedcff06b081203-Rnos3iOhNnMF1pS44AUWwor%2BJw8%3D&expires=8h&chkbd=0&chkv=2&dp-logid=4111511902857508725&dp-callid=0&dstime=1596179809&r=802381259';
          filename: 'AdventureCoveWaterparkMap.jpg';
          fs_id: 414244021542671;
          height: 1379;
          isdir: 0;
          md5: '1261d72d03471f7b7b805fd60e024b8d';
          oper_id: 2082810368;
          path: '/测试目录/AdventureCoveWaterparkMap.jpg';
          server_ctime: 1475996301;
          server_mtime: 1596077947;
          size: 642374;
          thumbs: {
            icon: 'https://thumbnail0.baidupcs.com/thumbnail/1261d72d03471f7b7b805fd60e024b8d?fid=2082810368-250528-414244021542671&rt=pr&sign=FDTAER-DCb740ccc5511e5e8fedcff06b081203-WFrLp5fm4e8R5rkMgRiJcXvcgaE%3D&expires=8h&chkbd=0&chkv=0&dp-logid=4111511813362484537&dp-callid=0&time=1596178800&size=c60_u60&quality=100&vuk=2082810368&ft=image';
            url1: 'https://thumbnail0.baidupcs.com/thumbnail/1261d72d03471f7b7b805fd60e024b8d?fid=2082810368-250528-414244021542671&rt=pr&sign=FDTAER-DCb740ccc5511e5e8fedcff06b081203-WFrLp5fm4e8R5rkMgRiJcXvcgaE%3D&expires=8h&chkbd=0&chkv=0&dp-logid=4111511813362484537&dp-callid=0&time=1596178800&size=c140_u90&quality=100&vuk=2082810368&ft=image';
            url2: 'https://thumbnail0.baidupcs.com/thumbnail/1261d72d03471f7b7b805fd60e024b8d?fid=2082810368-250528-414244021542671&rt=pr&sign=FDTAER-DCb740ccc5511e5e8fedcff06b081203-WFrLp5fm4e8R5rkMgRiJcXvcgaE%3D&expires=8h&chkbd=0&chkv=0&dp-logid=4111511813362484537&dp-callid=0&time=1596178800&size=c360_u270&quality=100&vuk=2082810368&ft=image';
            url3: 'https://thumbnail0.baidupcs.com/thumbnail/1261d72d03471f7b7b805fd60e024b8d?fid=2082810368-250528-414244021542671&rt=pr&sign=FDTAER-DCb740ccc5511e5e8fedcff06b081203-WFrLp5fm4e8R5rkMgRiJcXvcgaE%3D&expires=8h&chkbd=0&chkv=0&dp-logid=4111511813362484537&dp-callid=0&time=1596178800&size=c850_u580&quality=100&vuk=2082810368&ft=image';
          };
          width: 1600;
        }
      ];
      request_id: '4111827552384370545';
    }>(url, {
      responseType: 'json',
    });
    if (errno != 0) {
      console.error('获取baidu 文件信息失败:' + errno);
      return { errno };
    } else {
      return { errno, list };
    }
  } catch (error) {
    console.error('获取baidu 文件信息失败:' + error);
    return null;
  }
}

export async function downloadFile(accessToken: string, url: string) {
  try {
    const { body } = await got(`${url}&access_token=${accessToken}`, {
      responseType: 'json',
    });
    return body;
  } catch (error) {
    console.error('下载baidu 文件失败:' + error);
    return null;
  }
}
