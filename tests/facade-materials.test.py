"""Run with .cache/registration-venv/bin/python tests/facade-materials.test.py."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('facade_materials',Path(__file__).resolve().parents[1]/'scripts/prepare_facade_materials.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PerspectiveTest(unittest.TestCase):
    def test_rectified_corners_map_to_the_original_photo(self):
        for _,_,quad,_,_ in module.PATCHES:
            a,b,c,d,e,f,g,h=module.perspective_coefficients(quad,256)
            for (x,y),expected in zip([(0,0),(256,0),(256,256),(0,256)],quad):
                actual=[(a*x+b*y+c)/(g*x+h*y+1),(d*x+e*y+f)/(g*x+h*y+1)]
                np.testing.assert_allclose(actual,expected,atol=1e-8)

    def test_perspective_preserves_straight_architectural_edges(self):
        quad=[(70,15),(290,65),(245,240),(20,200)]
        a,b,c,d,e,f,g,h=module.perspective_coefficients(quad,256)
        points=[]
        for x in [0,64,128,192,256]:
            y=97
            points.append([(a*x+b*y+c)/(g*x+h*y+1),(d*x+e*y+f)/(g*x+h*y+1),1])
        self.assertEqual(np.linalg.matrix_rank(points,tol=1e-8),2)

if __name__=='__main__':
    unittest.main()
