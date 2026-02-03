const typeOf = require('type-of');
const CryptoJS = require('crypto-js');

const JSON_PRIMITIVE_TYPES = ['string', 'number', 'boolean', 'null'];

const encryptor = (commonKey: string) => (value: any) => {
  const type = typeOf(value);
  if (!JSON_PRIMITIVE_TYPES.includes(type)) {
    throw new Error(`Unsupported type (${type}) of ${value}`);
  }
  const valueJson = JSON.stringify({ v: value });
  const enc = CryptoJS.AES.encrypt(valueJson, commonKey).toString();
  return enc;
};

const decryptor = (commonKey: string) => (enc: any) => {
  const valueJson = CryptoJS.AES.decrypt(enc, commonKey).toString(CryptoJS.enc.Utf8);
  const { v: value } = JSON.parse(valueJson);
  return value;
};

function recurseTranslate(obj: any, translate: (a: any) => any): any {
  switch (typeOf(obj)) {
    case 'object':
      return Object.keys(obj).reduce((translated, key) => Object.assign(translated, { [key]: recurseTranslate(obj[key], translate) }), {});
    case 'array':
      return obj.map((value: any) => recurseTranslate(value, translate));
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
      return translate(obj);
    default:
      throw new Error(`Unsupported type (${typeOf(obj)}) of ${obj}`);
  }
}

export function encryptObj(obj: Record<string, any>, commonKey: string) {
  const encrypt = encryptor(commonKey);
  return recurseTranslate(obj, encrypt);
}

export function decryptObj(obj: Record<string, any>, commonKey: string) {
  const decrypt = decryptor(commonKey);
  return recurseTranslate(obj, decrypt);
  return obj;
}
