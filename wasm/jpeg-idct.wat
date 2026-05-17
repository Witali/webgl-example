(module
  (memory (export "memory") 1)

  (func $minI32 (param $a i32) (param $b i32) (result i32)
    local.get $a
    local.get $b
    i32.lt_s
    if (result i32)
      local.get $a
    else
      local.get $b
    end
  )

  (func $clampIndex (param $value i32) (param $limit i32) (result i32)
    local.get $value
    i32.const 0
    i32.lt_s
    if (result i32)
      i32.const 0
    else
      local.get $value
      local.get $limit
      i32.ge_s
      if (result i32)
        local.get $limit
        i32.const 1
        i32.sub
      else
        local.get $value
      end
    end
  )

  (func $loadPlaneValue
    (param $planePtr i32)
    (param $planeWidth i32)
    (param $x i32)
    (param $y i32)
    (result f64)
    local.get $planePtr
    local.get $y
    local.get $planeWidth
    i32.mul
    local.get $x
    i32.add
    i32.const 4
    i32.mul
    i32.add
    f32.load
    f64.promote_f32
  )

  (func $clampToByte (param $value f64) (result i32)
    local.get $value
    f64.const 0
    f64.lt
    if (result i32)
      i32.const 0
    else
      local.get $value
      f64.const 255
      f64.gt
      if (result i32)
        i32.const 255
      else
        local.get $value
        f64.const 0.5
        f64.add
        i32.trunc_f64_s
      end
    end
  )

  (func $decodeComponent
    (param $coeffPtr i32)
    (param $blocksX i32)
    (param $blocksY i32)
    (param $compH i32)
    (param $compV i32)
    (param $maxH i32)
    (param $maxV i32)
    (param $basisPtr i32)
    (param $imageX i32)
    (param $imageY i32)
    (result f64)
    (local $coeffWidth i32)
    (local $coeffHeight i32)
    (local $componentX i32)
    (local $componentY i32)
    (local $blockX i32)
    (local $blockY i32)
    (local $localX i32)
    (local $localY i32)
    (local $blockBase i32)
    (local $row i32)
    (local $column i32)
    (local $sum f64)

    local.get $blocksX
    i32.const 8
    i32.mul
    local.set $coeffWidth

    local.get $blocksY
    i32.const 8
    i32.mul
    local.set $coeffHeight

    local.get $imageX
    local.get $compH
    i32.mul
    local.get $maxH
    i32.div_u
    local.get $coeffWidth
    i32.const 1
    i32.sub
    call $minI32
    local.set $componentX

    local.get $imageY
    local.get $compV
    i32.mul
    local.get $maxV
    i32.div_u
    local.get $coeffHeight
    i32.const 1
    i32.sub
    call $minI32
    local.set $componentY

    local.get $componentX
    i32.const 3
    i32.shr_u
    local.set $blockX

    local.get $componentY
    i32.const 3
    i32.shr_u
    local.set $blockY

    local.get $componentX
    i32.const 7
    i32.and
    local.set $localX

    local.get $componentY
    i32.const 7
    i32.and
    local.set $localY

    local.get $coeffPtr
    local.get $blockY
    local.get $blocksX
    i32.mul
    local.get $blockX
    i32.add
    i32.const 64
    i32.mul
    i32.const 4
    i32.mul
    i32.add
    local.set $blockBase

    f64.const 0
    local.set $sum
    i32.const 0
    local.set $row

    block $rowDone
      loop $rowLoop
        local.get $row
        i32.const 8
        i32.ge_u
        br_if $rowDone

        i32.const 0
        local.set $column

        block $columnDone
          loop $columnLoop
            local.get $column
            i32.const 8
            i32.ge_u
            br_if $columnDone

            local.get $sum

            local.get $blockBase
            local.get $row
            i32.const 8
            i32.mul
            local.get $column
            i32.add
            i32.const 4
            i32.mul
            i32.add
            f32.load
            f64.promote_f32

            local.get $basisPtr
            local.get $localX
            i32.const 8
            i32.mul
            local.get $column
            i32.add
            i32.const 4
            i32.mul
            i32.add
            f32.load
            f64.promote_f32

            f64.mul

            local.get $basisPtr
            local.get $localY
            i32.const 8
            i32.mul
            local.get $row
            i32.add
            i32.const 4
            i32.mul
            i32.add
            f32.load
            f64.promote_f32

            f64.mul
            f64.add
            local.set $sum

            local.get $column
            i32.const 1
            i32.add
            local.set $column
            br $columnLoop
          end
        end

        local.get $row
        i32.const 1
        i32.add
        local.set $row
        br $rowLoop
      end
    end

    local.get $sum
    f64.const 0.25
    f64.mul
    f64.const 128
    f64.add
  )

  (func $samplePlane
    (param $planePtr i32)
    (param $blocksX i32)
    (param $blocksY i32)
    (param $compH i32)
    (param $compV i32)
    (param $maxH i32)
    (param $maxV i32)
    (param $imageX i32)
    (param $imageY i32)
    (result f64)
    (local $planeWidth i32)
    (local $planeHeight i32)
    (local $componentX i32)
    (local $componentY i32)

    local.get $blocksX
    i32.const 8
    i32.mul
    local.set $planeWidth

    local.get $blocksY
    i32.const 8
    i32.mul
    local.set $planeHeight

    local.get $imageX
    local.get $compH
    i32.mul
    local.get $maxH
    i32.div_u
    local.get $planeWidth
    i32.const 1
    i32.sub
    call $minI32
    local.set $componentX

    local.get $imageY
    local.get $compV
    i32.mul
    local.get $maxV
    i32.div_u
    local.get $planeHeight
    i32.const 1
    i32.sub
    call $minI32
    local.set $componentY

    local.get $planePtr
    local.get $componentY
    local.get $planeWidth
    i32.mul
    local.get $componentX
    i32.add
    i32.const 4
    i32.mul
    i32.add
    f32.load
    f64.promote_f32
  )

  (func $samplePlaneLinear
    (param $planePtr i32)
    (param $blocksX i32)
    (param $blocksY i32)
    (param $compH i32)
    (param $compV i32)
    (param $maxH i32)
    (param $maxV i32)
    (param $imageX i32)
    (param $imageY i32)
    (result f64)
    (local $planeWidth i32)
    (local $planeHeight i32)
    (local $coordX f64)
    (local $coordY f64)
    (local $floorX f64)
    (local $floorY f64)
    (local $x0 i32)
    (local $x1 i32)
    (local $y0 i32)
    (local $y1 i32)
    (local $fx f64)
    (local $fy f64)
    (local $v00 f64)
    (local $v10 f64)
    (local $v01 f64)
    (local $v11 f64)
    (local $top f64)
    (local $bottom f64)

    local.get $blocksX
    i32.const 8
    i32.mul
    local.set $planeWidth

    local.get $blocksY
    i32.const 8
    i32.mul
    local.set $planeHeight

    local.get $imageX
    f64.convert_i32_u
    f64.const 0.5
    f64.add
    local.get $compH
    f64.convert_i32_u
    f64.mul
    local.get $maxH
    f64.convert_i32_u
    f64.div
    f64.const 0.5
    f64.sub
    local.set $coordX

    local.get $imageY
    f64.convert_i32_u
    f64.const 0.5
    f64.add
    local.get $compV
    f64.convert_i32_u
    f64.mul
    local.get $maxV
    f64.convert_i32_u
    f64.div
    f64.const 0.5
    f64.sub
    local.set $coordY

    local.get $coordX
    f64.floor
    local.set $floorX

    local.get $coordY
    f64.floor
    local.set $floorY

    local.get $floorX
    i32.trunc_f64_s
    local.get $planeWidth
    call $clampIndex
    local.set $x0

    local.get $floorX
    i32.trunc_f64_s
    i32.const 1
    i32.add
    local.get $planeWidth
    call $clampIndex
    local.set $x1

    local.get $floorY
    i32.trunc_f64_s
    local.get $planeHeight
    call $clampIndex
    local.set $y0

    local.get $floorY
    i32.trunc_f64_s
    i32.const 1
    i32.add
    local.get $planeHeight
    call $clampIndex
    local.set $y1

    local.get $coordX
    local.get $floorX
    f64.sub
    local.set $fx

    local.get $coordY
    local.get $floorY
    f64.sub
    local.set $fy

    local.get $x0
    local.get $x1
    i32.eq
    if
      f64.const 0
      local.set $fx
    end

    local.get $y0
    local.get $y1
    i32.eq
    if
      f64.const 0
      local.set $fy
    end

    local.get $planePtr
    local.get $planeWidth
    local.get $x0
    local.get $y0
    call $loadPlaneValue
    local.set $v00

    local.get $planePtr
    local.get $planeWidth
    local.get $x1
    local.get $y0
    call $loadPlaneValue
    local.set $v10

    local.get $planePtr
    local.get $planeWidth
    local.get $x0
    local.get $y1
    call $loadPlaneValue
    local.set $v01

    local.get $planePtr
    local.get $planeWidth
    local.get $x1
    local.get $y1
    call $loadPlaneValue
    local.set $v11

    local.get $v00
    local.get $v10
    local.get $v00
    f64.sub
    local.get $fx
    f64.mul
    f64.add
    local.set $top

    local.get $v01
    local.get $v11
    local.get $v01
    f64.sub
    local.get $fx
    f64.mul
    f64.add
    local.set $bottom

    local.get $top
    local.get $bottom
    local.get $top
    f64.sub
    local.get $fy
    f64.mul
    f64.add
  )

  (func $reconstructComponent
    (param $coeffPtr i32)
    (param $blocksX i32)
    (param $blocksY i32)
    (param $basisPtr i32)
    (param $tempPtr i32)
    (param $planePtr i32)
    (local $planeWidth i32)
    (local $blockX i32)
    (local $blockY i32)
    (local $localX i32)
    (local $localY i32)
    (local $u i32)
    (local $v i32)
    (local $blockBase i32)
    (local $sum f64)

    local.get $blocksX
    i32.const 8
    i32.mul
    local.set $planeWidth

    i32.const 0
    local.set $blockY

    block $blockYDone
      loop $blockYLoop
        local.get $blockY
        local.get $blocksY
        i32.ge_u
        br_if $blockYDone

        i32.const 0
        local.set $blockX

        block $blockXDone
          loop $blockXLoop
            local.get $blockX
            local.get $blocksX
            i32.ge_u
            br_if $blockXDone

            local.get $coeffPtr
            local.get $blockY
            local.get $blocksX
            i32.mul
            local.get $blockX
            i32.add
            i32.const 64
            i32.mul
            i32.const 4
            i32.mul
            i32.add
            local.set $blockBase

            i32.const 0
            local.set $localY

            block $firstPassYDone
              loop $firstPassYLoop
                local.get $localY
                i32.const 8
                i32.ge_u
                br_if $firstPassYDone

                i32.const 0
                local.set $u

                block $firstPassUDone
                  loop $firstPassULoop
                    local.get $u
                    i32.const 8
                    i32.ge_u
                    br_if $firstPassUDone

                    f64.const 0
                    local.set $sum
                    i32.const 0
                    local.set $v

                    block $firstPassVDone
                      loop $firstPassVLoop
                        local.get $v
                        i32.const 8
                        i32.ge_u
                        br_if $firstPassVDone

                        local.get $sum
                        local.get $blockBase
                        local.get $v
                        i32.const 8
                        i32.mul
                        local.get $u
                        i32.add
                        i32.const 4
                        i32.mul
                        i32.add
                        f32.load
                        f64.promote_f32
                        local.get $basisPtr
                        local.get $localY
                        i32.const 8
                        i32.mul
                        local.get $v
                        i32.add
                        i32.const 4
                        i32.mul
                        i32.add
                        f32.load
                        f64.promote_f32
                        f64.mul
                        f64.add
                        local.set $sum

                        local.get $v
                        i32.const 1
                        i32.add
                        local.set $v
                        br $firstPassVLoop
                      end
                    end

                    local.get $tempPtr
                    local.get $localY
                    i32.const 8
                    i32.mul
                    local.get $u
                    i32.add
                    i32.const 8
                    i32.mul
                    i32.add
                    local.get $sum
                    f64.store

                    local.get $u
                    i32.const 1
                    i32.add
                    local.set $u
                    br $firstPassULoop
                  end
                end

                local.get $localY
                i32.const 1
                i32.add
                local.set $localY
                br $firstPassYLoop
              end
            end

            i32.const 0
            local.set $localY

            block $secondPassYDone
              loop $secondPassYLoop
                local.get $localY
                i32.const 8
                i32.ge_u
                br_if $secondPassYDone

                i32.const 0
                local.set $localX

                block $secondPassXDone
                  loop $secondPassXLoop
                    local.get $localX
                    i32.const 8
                    i32.ge_u
                    br_if $secondPassXDone

                    f64.const 0
                    local.set $sum
                    i32.const 0
                    local.set $u

                    block $secondPassUDone
                      loop $secondPassULoop
                        local.get $u
                        i32.const 8
                        i32.ge_u
                        br_if $secondPassUDone

                        local.get $sum
                        local.get $tempPtr
                        local.get $localY
                        i32.const 8
                        i32.mul
                        local.get $u
                        i32.add
                        i32.const 8
                        i32.mul
                        i32.add
                        f64.load
                        local.get $basisPtr
                        local.get $localX
                        i32.const 8
                        i32.mul
                        local.get $u
                        i32.add
                        i32.const 4
                        i32.mul
                        i32.add
                        f32.load
                        f64.promote_f32
                        f64.mul
                        f64.add
                        local.set $sum

                        local.get $u
                        i32.const 1
                        i32.add
                        local.set $u
                        br $secondPassULoop
                      end
                    end

                    local.get $planePtr
                    local.get $blockY
                    i32.const 8
                    i32.mul
                    local.get $localY
                    i32.add
                    local.get $planeWidth
                    i32.mul
                    local.get $blockX
                    i32.const 8
                    i32.mul
                    local.get $localX
                    i32.add
                    i32.add
                    i32.const 4
                    i32.mul
                    i32.add
                    local.get $sum
                    f64.const 0.25
                    f64.mul
                    f64.const 128
                    f64.add
                    call $clampToByte
                    f64.convert_i32_u
                    f32.demote_f64
                    f32.store

                    local.get $localX
                    i32.const 1
                    i32.add
                    local.set $localX
                    br $secondPassXLoop
                  end
                end

                local.get $localY
                i32.const 1
                i32.add
                local.set $localY
                br $secondPassYLoop
              end
            end

            local.get $blockX
            i32.const 1
            i32.add
            local.set $blockX
            br $blockXLoop
          end
        end

        local.get $blockY
        i32.const 1
        i32.add
        local.set $blockY
        br $blockYLoop
      end
    end
  )

  (func (export "decode")
    (param $width i32)
    (param $height i32)
    (param $componentCount i32)
    (param $maxH i32)
    (param $maxV i32)
    (param $basisPtr i32)
    (param $c0Ptr i32)
    (param $c0BlocksX i32)
    (param $c0BlocksY i32)
    (param $c0H i32)
    (param $c0V i32)
    (param $c1Ptr i32)
    (param $c1BlocksX i32)
    (param $c1BlocksY i32)
    (param $c1H i32)
    (param $c1V i32)
    (param $c2Ptr i32)
    (param $c2BlocksX i32)
    (param $c2BlocksY i32)
    (param $c2H i32)
    (param $c2V i32)
    (param $outPtr i32)
    (local $x i32)
    (local $y i32)
    (local $outIndex i32)
    (local $byte i32)
    (local $yValue f64)
    (local $cbValue f64)
    (local $crValue f64)

    i32.const 0
    local.set $y

    block $yDone
      loop $yLoop
        local.get $y
        local.get $height
        i32.ge_u
        br_if $yDone

        i32.const 0
        local.set $x

        block $xDone
          loop $xLoop
            local.get $x
            local.get $width
            i32.ge_u
            br_if $xDone

            local.get $y
            local.get $width
            i32.mul
            local.get $x
            i32.add
            i32.const 4
            i32.mul
            local.get $outPtr
            i32.add
            local.set $outIndex

            local.get $c0Ptr
            local.get $c0BlocksX
            local.get $c0BlocksY
            local.get $c0H
            local.get $c0V
            local.get $maxH
            local.get $maxV
            local.get $basisPtr
            local.get $x
            local.get $y
            call $decodeComponent
            local.set $yValue

            local.get $componentCount
            i32.const 1
            i32.eq
            if
              local.get $yValue
              call $clampToByte
              local.set $byte

              local.get $outIndex
              local.get $byte
              i32.store8
              local.get $outIndex
              i32.const 1
              i32.add
              local.get $byte
              i32.store8
              local.get $outIndex
              i32.const 2
              i32.add
              local.get $byte
              i32.store8
            else
              local.get $c1Ptr
              local.get $c1BlocksX
              local.get $c1BlocksY
              local.get $c1H
              local.get $c1V
              local.get $maxH
              local.get $maxV
              local.get $basisPtr
              local.get $x
              local.get $y
              call $decodeComponent
              f64.const 128
              f64.sub
              local.set $cbValue

              local.get $c2Ptr
              local.get $c2BlocksX
              local.get $c2BlocksY
              local.get $c2H
              local.get $c2V
              local.get $maxH
              local.get $maxV
              local.get $basisPtr
              local.get $x
              local.get $y
              call $decodeComponent
              f64.const 128
              f64.sub
              local.set $crValue

              local.get $outIndex
              local.get $yValue
              local.get $crValue
              f64.const 1.402
              f64.mul
              f64.add
              call $clampToByte
              i32.store8

              local.get $outIndex
              i32.const 1
              i32.add
              local.get $yValue
              local.get $cbValue
              f64.const 0.344136286201022
              f64.mul
              f64.sub
              local.get $crValue
              f64.const 0.714136285714286
              f64.mul
              f64.sub
              call $clampToByte
              i32.store8

              local.get $outIndex
              i32.const 2
              i32.add
              local.get $yValue
              local.get $cbValue
              f64.const 1.772
              f64.mul
              f64.add
              call $clampToByte
              i32.store8
            end

            local.get $outIndex
            i32.const 3
            i32.add
            i32.const 255
            i32.store8

            local.get $x
            i32.const 1
            i32.add
            local.set $x
            br $xLoop
          end
        end

        local.get $y
        i32.const 1
        i32.add
        local.set $y
        br $yLoop
      end
    end
  )

  (func (export "decodeFast")
    (param $width i32)
    (param $height i32)
    (param $componentCount i32)
    (param $maxH i32)
    (param $maxV i32)
    (param $basisPtr i32)
    (param $c0Ptr i32)
    (param $c0BlocksX i32)
    (param $c0BlocksY i32)
    (param $c0H i32)
    (param $c0V i32)
    (param $c0PlanePtr i32)
    (param $c1Ptr i32)
    (param $c1BlocksX i32)
    (param $c1BlocksY i32)
    (param $c1H i32)
    (param $c1V i32)
    (param $c1PlanePtr i32)
    (param $c2Ptr i32)
    (param $c2BlocksX i32)
    (param $c2BlocksY i32)
    (param $c2H i32)
    (param $c2V i32)
    (param $c2PlanePtr i32)
    (param $tempPtr i32)
    (param $outPtr i32)
    (local $x i32)
    (local $y i32)
    (local $outIndex i32)
    (local $byte i32)
    (local $yValue f64)
    (local $cbValue f64)
    (local $crValue f64)

    local.get $c0Ptr
    local.get $c0BlocksX
    local.get $c0BlocksY
    local.get $basisPtr
    local.get $tempPtr
    local.get $c0PlanePtr
    call $reconstructComponent

    local.get $componentCount
    i32.const 1
    i32.ne
    if
      local.get $c1Ptr
      local.get $c1BlocksX
      local.get $c1BlocksY
      local.get $basisPtr
      local.get $tempPtr
      local.get $c1PlanePtr
      call $reconstructComponent

      local.get $c2Ptr
      local.get $c2BlocksX
      local.get $c2BlocksY
      local.get $basisPtr
      local.get $tempPtr
      local.get $c2PlanePtr
      call $reconstructComponent
    end

    i32.const 0
    local.set $y

    block $yDone
      loop $yLoop
        local.get $y
        local.get $height
        i32.ge_u
        br_if $yDone

        i32.const 0
        local.set $x

        block $xDone
          loop $xLoop
            local.get $x
            local.get $width
            i32.ge_u
            br_if $xDone

            local.get $y
            local.get $width
            i32.mul
            local.get $x
            i32.add
            i32.const 4
            i32.mul
            local.get $outPtr
            i32.add
            local.set $outIndex

            local.get $c0PlanePtr
            local.get $c0BlocksX
            local.get $c0BlocksY
            local.get $c0H
            local.get $c0V
            local.get $maxH
            local.get $maxV
            local.get $x
            local.get $y
            call $samplePlaneLinear
            local.set $yValue

            local.get $componentCount
            i32.const 1
            i32.eq
            if
              local.get $yValue
              call $clampToByte
              local.set $byte

              local.get $outIndex
              local.get $byte
              i32.store8
              local.get $outIndex
              i32.const 1
              i32.add
              local.get $byte
              i32.store8
              local.get $outIndex
              i32.const 2
              i32.add
              local.get $byte
              i32.store8
            else
              local.get $c1PlanePtr
              local.get $c1BlocksX
              local.get $c1BlocksY
              local.get $c1H
              local.get $c1V
              local.get $maxH
              local.get $maxV
              local.get $x
              local.get $y
              call $samplePlaneLinear
              f64.const 128
              f64.sub
              local.set $cbValue

              local.get $c2PlanePtr
              local.get $c2BlocksX
              local.get $c2BlocksY
              local.get $c2H
              local.get $c2V
              local.get $maxH
              local.get $maxV
              local.get $x
              local.get $y
              call $samplePlaneLinear
              f64.const 128
              f64.sub
              local.set $crValue

              local.get $outIndex
              local.get $yValue
              local.get $crValue
              f64.const 1.402
              f64.mul
              f64.add
              call $clampToByte
              i32.store8

              local.get $outIndex
              i32.const 1
              i32.add
              local.get $yValue
              local.get $cbValue
              f64.const 0.344136
              f64.mul
              f64.sub
              local.get $crValue
              f64.const 0.714136
              f64.mul
              f64.sub
              call $clampToByte
              i32.store8

              local.get $outIndex
              i32.const 2
              i32.add
              local.get $yValue
              local.get $cbValue
              f64.const 1.772
              f64.mul
              f64.add
              call $clampToByte
              i32.store8
            end

            local.get $outIndex
            i32.const 3
            i32.add
            i32.const 255
            i32.store8

            local.get $x
            i32.const 1
            i32.add
            local.set $x
            br $xLoop
          end
        end

        local.get $y
        i32.const 1
        i32.add
        local.set $y
        br $yLoop
      end
    end
  )

  (func (export "packCoefficientAtlas")
    (param $coeffPtr i32)
    (param $blocksX i32)
    (param $blocksY i32)
    (param $atlasPtr i32)
    (local $blockX i32)
    (local $blockY i32)
    (local $row i32)
    (local $column i32)
    (local $sourceIndex i32)
    (local $targetIndex i32)
    (local $atlasWidth i32)

    local.get $blocksX
    i32.const 8
    i32.mul
    local.set $atlasWidth

    i32.const 0
    local.set $blockY

    block $blockYDone
      loop $blockYLoop
        local.get $blockY
        local.get $blocksY
        i32.ge_u
        br_if $blockYDone

        i32.const 0
        local.set $blockX

        block $blockXDone
          loop $blockXLoop
            local.get $blockX
            local.get $blocksX
            i32.ge_u
            br_if $blockXDone

            i32.const 0
            local.set $row

            block $rowDone
              loop $rowLoop
                local.get $row
                i32.const 8
                i32.ge_u
                br_if $rowDone

                i32.const 0
                local.set $column

                block $columnDone
                  loop $columnLoop
                    local.get $column
                    i32.const 8
                    i32.ge_u
                    br_if $columnDone

                    local.get $blockY
                    local.get $blocksX
                    i32.mul
                    local.get $blockX
                    i32.add
                    i32.const 64
                    i32.mul
                    local.get $row
                    i32.const 8
                    i32.mul
                    i32.add
                    local.get $column
                    i32.add
                    i32.const 4
                    i32.mul
                    local.get $coeffPtr
                    i32.add
                    local.set $sourceIndex

                    local.get $blockY
                    i32.const 8
                    i32.mul
                    local.get $row
                    i32.add
                    local.get $atlasWidth
                    i32.mul
                    local.get $blockX
                    i32.const 8
                    i32.mul
                    local.get $column
                    i32.add
                    i32.add
                    i32.const 16
                    i32.mul
                    local.get $atlasPtr
                    i32.add
                    local.set $targetIndex

                    local.get $targetIndex
                    local.get $sourceIndex
                    f32.load
                    f32.store

                    local.get $targetIndex
                    i32.const 4
                    i32.add
                    f32.const 0
                    f32.store

                    local.get $targetIndex
                    i32.const 8
                    i32.add
                    f32.const 0
                    f32.store

                    local.get $targetIndex
                    i32.const 12
                    i32.add
                    f32.const 1
                    f32.store

                    local.get $column
                    i32.const 1
                    i32.add
                    local.set $column
                    br $columnLoop
                  end
                end

                local.get $row
                i32.const 1
                i32.add
                local.set $row
                br $rowLoop
              end
            end

            local.get $blockX
            i32.const 1
            i32.add
            local.set $blockX
            br $blockXLoop
          end
        end

        local.get $blockY
        i32.const 1
        i32.add
        local.set $blockY
        br $blockYLoop
      end
    end
  )
)
