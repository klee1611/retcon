import { Route, Routes } from "react-router-dom"

import { Layout } from "@/components/Layout"
import { Landing } from "@/pages/Landing"
import { HowItWorks } from "@/pages/HowItWorks"
import { Eval, NotFound, Play } from "@/pages/Placeholder"

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="play/:scenario" element={<Play />} />
        <Route path="how-it-works" element={<HowItWorks />} />
        <Route path="eval" element={<Eval />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
