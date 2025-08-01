package btcindexer

// Code generated by github.com/tinylib/msgp DO NOT EDIT.

import (
	"github.com/tinylib/msgp/msgp"
)

// DecodeMsg implements msgp.Decodable
func (z *PutBlock) DecodeMsg(dc *msgp.Reader) (err error) {
	var field []byte
	_ = field
	var zb0001 uint32
	zb0001, err = dc.ReadMapHeader()
	if err != nil {
		err = msgp.WrapError(err)
		return
	}
	for zb0001 > 0 {
		zb0001--
		field, err = dc.ReadMapKeyPtr()
		if err != nil {
			err = msgp.WrapError(err)
			return
		}
		switch msgp.UnsafeString(field) {
		case "height":
			z.Height, err = dc.ReadInt64()
			if err != nil {
				err = msgp.WrapError(err, "Height")
				return
			}
		case "block":
			z.Block, err = dc.ReadBytes(z.Block)
			if err != nil {
				err = msgp.WrapError(err, "Block")
				return
			}
		default:
			err = dc.Skip()
			if err != nil {
				err = msgp.WrapError(err)
				return
			}
		}
	}
	return
}

// EncodeMsg implements msgp.Encodable
func (z *PutBlock) EncodeMsg(en *msgp.Writer) (err error) {
	// map header, size 2
	// write "height"
	err = en.Append(0x82, 0xa6, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74)
	if err != nil {
		return
	}
	err = en.WriteInt64(z.Height)
	if err != nil {
		err = msgp.WrapError(err, "Height")
		return
	}
	// write "block"
	err = en.Append(0xa5, 0x62, 0x6c, 0x6f, 0x63, 0x6b)
	if err != nil {
		return
	}
	err = en.WriteBytes(z.Block)
	if err != nil {
		err = msgp.WrapError(err, "Block")
		return
	}
	return
}

// MarshalMsg implements msgp.Marshaler
func (z *PutBlock) MarshalMsg(b []byte) (o []byte, err error) {
	o = msgp.Require(b, z.Msgsize())
	// map header, size 2
	// string "height"
	o = append(o, 0x82, 0xa6, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74)
	o = msgp.AppendInt64(o, z.Height)
	// string "block"
	o = append(o, 0xa5, 0x62, 0x6c, 0x6f, 0x63, 0x6b)
	o = msgp.AppendBytes(o, z.Block)
	return
}

// UnmarshalMsg implements msgp.Unmarshaler
func (z *PutBlock) UnmarshalMsg(bts []byte) (o []byte, err error) {
	var field []byte
	_ = field
	var zb0001 uint32
	zb0001, bts, err = msgp.ReadMapHeaderBytes(bts)
	if err != nil {
		err = msgp.WrapError(err)
		return
	}
	for zb0001 > 0 {
		zb0001--
		field, bts, err = msgp.ReadMapKeyZC(bts)
		if err != nil {
			err = msgp.WrapError(err)
			return
		}
		switch msgp.UnsafeString(field) {
		case "height":
			z.Height, bts, err = msgp.ReadInt64Bytes(bts)
			if err != nil {
				err = msgp.WrapError(err, "Height")
				return
			}
		case "block":
			z.Block, bts, err = msgp.ReadBytesBytes(bts, z.Block)
			if err != nil {
				err = msgp.WrapError(err, "Block")
				return
			}
		default:
			bts, err = msgp.Skip(bts)
			if err != nil {
				err = msgp.WrapError(err)
				return
			}
		}
	}
	o = bts
	return
}

// Msgsize returns an upper bound estimate of the number of bytes occupied by the serialized message
func (z *PutBlock) Msgsize() (s int) {
	s = 1 + 7 + msgp.Int64Size + 6 + msgp.BytesPrefixSize + len(z.Block)
	return
}

// DecodeMsg implements msgp.Decodable
func (z *PutBlocksReq) DecodeMsg(dc *msgp.Reader) (err error) {
	var zb0002 uint32
	zb0002, err = dc.ReadArrayHeader()
	if err != nil {
		err = msgp.WrapError(err)
		return
	}
	if cap((*z)) >= int(zb0002) {
		(*z) = (*z)[:zb0002]
	} else {
		(*z) = make(PutBlocksReq, zb0002)
	}
	for zb0001 := range *z {
		var field []byte
		_ = field
		var zb0003 uint32
		zb0003, err = dc.ReadMapHeader()
		if err != nil {
			err = msgp.WrapError(err, zb0001)
			return
		}
		for zb0003 > 0 {
			zb0003--
			field, err = dc.ReadMapKeyPtr()
			if err != nil {
				err = msgp.WrapError(err, zb0001)
				return
			}
			switch msgp.UnsafeString(field) {
			case "height":
				(*z)[zb0001].Height, err = dc.ReadInt64()
				if err != nil {
					err = msgp.WrapError(err, zb0001, "Height")
					return
				}
			case "block":
				(*z)[zb0001].Block, err = dc.ReadBytes((*z)[zb0001].Block)
				if err != nil {
					err = msgp.WrapError(err, zb0001, "Block")
					return
				}
			default:
				err = dc.Skip()
				if err != nil {
					err = msgp.WrapError(err, zb0001)
					return
				}
			}
		}
	}
	return
}

// EncodeMsg implements msgp.Encodable
func (z PutBlocksReq) EncodeMsg(en *msgp.Writer) (err error) {
	err = en.WriteArrayHeader(uint32(len(z)))
	if err != nil {
		err = msgp.WrapError(err)
		return
	}
	for zb0004 := range z {
		// map header, size 2
		// write "height"
		err = en.Append(0x82, 0xa6, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74)
		if err != nil {
			return
		}
		err = en.WriteInt64(z[zb0004].Height)
		if err != nil {
			err = msgp.WrapError(err, zb0004, "Height")
			return
		}
		// write "block"
		err = en.Append(0xa5, 0x62, 0x6c, 0x6f, 0x63, 0x6b)
		if err != nil {
			return
		}
		err = en.WriteBytes(z[zb0004].Block)
		if err != nil {
			err = msgp.WrapError(err, zb0004, "Block")
			return
		}
	}
	return
}

// MarshalMsg implements msgp.Marshaler
func (z PutBlocksReq) MarshalMsg(b []byte) (o []byte, err error) {
	o = msgp.Require(b, z.Msgsize())
	o = msgp.AppendArrayHeader(o, uint32(len(z)))
	for zb0004 := range z {
		// map header, size 2
		// string "height"
		o = append(o, 0x82, 0xa6, 0x68, 0x65, 0x69, 0x67, 0x68, 0x74)
		o = msgp.AppendInt64(o, z[zb0004].Height)
		// string "block"
		o = append(o, 0xa5, 0x62, 0x6c, 0x6f, 0x63, 0x6b)
		o = msgp.AppendBytes(o, z[zb0004].Block)
	}
	return
}

// UnmarshalMsg implements msgp.Unmarshaler
func (z *PutBlocksReq) UnmarshalMsg(bts []byte) (o []byte, err error) {
	var zb0002 uint32
	zb0002, bts, err = msgp.ReadArrayHeaderBytes(bts)
	if err != nil {
		err = msgp.WrapError(err)
		return
	}
	if cap((*z)) >= int(zb0002) {
		(*z) = (*z)[:zb0002]
	} else {
		(*z) = make(PutBlocksReq, zb0002)
	}
	for zb0001 := range *z {
		var field []byte
		_ = field
		var zb0003 uint32
		zb0003, bts, err = msgp.ReadMapHeaderBytes(bts)
		if err != nil {
			err = msgp.WrapError(err, zb0001)
			return
		}
		for zb0003 > 0 {
			zb0003--
			field, bts, err = msgp.ReadMapKeyZC(bts)
			if err != nil {
				err = msgp.WrapError(err, zb0001)
				return
			}
			switch msgp.UnsafeString(field) {
			case "height":
				(*z)[zb0001].Height, bts, err = msgp.ReadInt64Bytes(bts)
				if err != nil {
					err = msgp.WrapError(err, zb0001, "Height")
					return
				}
			case "block":
				(*z)[zb0001].Block, bts, err = msgp.ReadBytesBytes(bts, (*z)[zb0001].Block)
				if err != nil {
					err = msgp.WrapError(err, zb0001, "Block")
					return
				}
			default:
				bts, err = msgp.Skip(bts)
				if err != nil {
					err = msgp.WrapError(err, zb0001)
					return
				}
			}
		}
	}
	o = bts
	return
}

// Msgsize returns an upper bound estimate of the number of bytes occupied by the serialized message
func (z PutBlocksReq) Msgsize() (s int) {
	s = msgp.ArrayHeaderSize
	for zb0004 := range z {
		s += 1 + 7 + msgp.Int64Size + 6 + msgp.BytesPrefixSize + len(z[zb0004].Block)
	}
	return
}
