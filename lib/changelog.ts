export interface ChangelogItem {
  /** Material Symbols icon name. */
  icon: string;
  title: string;
  detail: string;
}

export interface ChangelogEntry {
  version: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  items: ChangelogItem[];
}

/**
 * Release notes shown in the "what's new" popup on the event map, newest
 * first. Adding an entry at the top re-shows the popup for everyone — the
 * "don't show again" choice is remembered per version.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.1.0',
    date: '2026-10-22',
    items: [
      {
        icon: 'swipe_vertical',
        title: 'ซูมแผนที่ด้วยนิ้วเดียว',
        detail: 'แตะสองครั้งแล้วค้างนิ้วไว้ ลากขึ้นเพื่อซูมเข้า ลากลงเพื่อซูมออก ใช้มือเดียวได้สะดวก',
      },
      {
        icon: 'zoom_in',
        title: 'ซูมกราฟความชันได้',
        detail: 'ใช้สองนิ้วถ่างบนกราฟ หรือกดปุ่ม + / − แล้วลากแถบด้านล่างเพื่อเลื่อนดูช่วงอื่น',
      },
      {
        icon: 'flag',
        title: 'เส้นประตำแหน่ง CP',
        detail: 'กราฟความชันแสดงจุดเช็กพอยต์ (CP) เป็นเส้นประ รู้ทันทีว่าแต่ละ CP อยู่ช่วงไหน',
      },
      {
        icon: 'my_location',
        title: 'ตำแหน่งของคุณบนกราฟ',
        detail: 'กดปุ่มหาตำแหน่ง แล้วกราฟจะบอกว่าคุณอยู่กิโลเมตรที่เท่าไรของเส้นทาง',
      },
      {
        icon: 'photo_camera',
        title: 'รูปนี้อยู่ตรงไหนในเส้นทาง',
        detail: 'ตอนดูรูปจะมีแผนที่เล็กบอกตำแหน่ง พร้อม km และช่วง CP ที่ถ่ายรูปนั้น',
      },
      {
        icon: 'near_me',
        title: 'ปุ่ม “ดูบนแผนที่”',
        detail: 'กดจากหน้าดูรูปเพื่อพาแผนที่ไปยังจุดที่ถ่ายรูปบนเส้นทางทันที',
      },
    ],
  },
];

export const LATEST_RELEASE = CHANGELOG[0];
