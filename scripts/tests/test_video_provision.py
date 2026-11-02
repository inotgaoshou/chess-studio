import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('provision',Path(__file__).parents[1]/'provision-video-library.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ManifestTests(unittest.TestCase):
 def test_hierarchy_natural_order_and_content_dedup(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);folder=root/'中局课'
   for chapter in ['谋势上','谋势下']:
    (folder/chapter).mkdir(parents=True)
    for name in ['10-1.mp4','2-1.mp4','1-1.mp4']:(folder/chapter/name).write_bytes(b'same-video')
   (folder/'.处理记录').mkdir();(folder/'.处理记录'/'hidden.mp4').write_bytes(b'ignore')
   m,files=module.build_manifest(root,['中局课'])
   videos=m['series'][0]['videos'];self.assertEqual(len(videos),6);self.assertEqual(len(files),1)
   self.assertEqual([v['title'] for v in videos[:3]],['1-1','2-1','10-1']);self.assertEqual(len({v['chapter'] for v in videos}),2)
   self.assertEqual(m['series'][0]['categoryId'],'category-middle');self.assertNotIn(str(root),str(m))
 def test_missing_series_fails_and_sample_limit(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)
   with self.assertRaises(ValueError):module.build_manifest(root,['missing'])
   (root/'布局').mkdir()
   for i in range(3):(root/'布局'/f'{i}.mp4').write_bytes(bytes([i]))
   m,_=module.build_manifest(root,['布局'],1);self.assertEqual(len(m['series'][0]['videos']),1)
if __name__=='__main__':unittest.main()
